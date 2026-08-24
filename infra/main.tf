terraform {
  required_version = ">= 1.9"

  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }

  # State currently lives in this directory. Before a second person touches this
  # stack, move it to an S3 backend with DynamoDB locking — two people running
  # apply against local state will corrupt each other's view of what exists.
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

locals {
  name = "${var.project}-${var.environment}"
}

# ---------------------------------------------------------------------------
# Network
#
# One public subnet and no NAT gateway, on purpose. A NAT gateway is about
# $32/month before a byte moves through it — nearly double the entire budget for
# this environment. Putting the single instance in a public subnet with a tight
# security group achieves the same isolation for staging at no cost.
#
# Production with a private database subnet is a different shape, and this file
# is structured so that is an addition rather than a rewrite.
# ---------------------------------------------------------------------------

resource "aws_vpc" "main" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${local.name}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-igw" }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.20.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = { Name = "${local.name}-public-a" }
}

# A second subnet in another AZ. Nothing uses it yet, but RDS demands a subnet
# group spanning two availability zones, and adding one later means recreating
# the database.
resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.20.2.0/24"
  availability_zone       = data.aws_availability_zones.available.names[1]
  map_public_ip_on_launch = true

  tags = { Name = "${local.name}-public-b" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${local.name}-public-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}

# ---------------------------------------------------------------------------
# Security group
# ---------------------------------------------------------------------------

resource "aws_security_group" "api" {
  name        = "${local.name}-api"
  description = "Kinvo API instance"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name}-api-sg" }
}

# HTTPS from anywhere. Used directly once a domain exists; until then CloudFront
# is the only practical caller, but CloudFront egresses from a large published
# IP range and locking to it adds a moving part for no real gain at this size.
resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.api.id
  description       = "HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# HTTP: the CloudFront origin fetch, and Caddy's ACME challenge once a domain
# is configured. Caddy redirects browsers to HTTPS.
resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.api.id
  description       = "HTTP - CloudFront origin and ACME challenge"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

# Closed by default. Administration goes through SSM Session Manager, which
# needs no inbound port at all and records who connected and when.
resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.api.id
  description       = "SSH - closed unless admin_cidr is set"
  cidr_ipv4         = var.admin_cidr
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.api.id
  description       = "All outbound"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# Postgres and Redis are deliberately absent. They run in Docker on the instance
# and listen on localhost only, so they are unreachable from outside the box.
# When production moves them to RDS and ElastiCache they get their own groups,
# reachable only from this one.
