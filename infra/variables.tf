variable "aws_region" {
  description = <<-EOT
    Which AWS region everything lives in.

    Deliberately has no default. This is not a detail — it sets the latency
    floor for every request the mobile app ever makes, and changing it later
    means rebuilding the whole stack and migrating the database.

      ap-south-1     Mumbai      ~40-60ms from Pakistan
      me-central-1   UAE         ~30-50ms from Pakistan
      eu-west-2      London      ~120ms
      us-east-1      Virginia    ~250-300ms, cheapest
  EOT
  type        = string
}

variable "environment" {
  description = "staging or production. Names and tags every resource."
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "project" {
  description = "Prefix for resource names."
  type        = string
  default     = "kinvo"
}

variable "instance_type" {
  description = <<-EOT
    ARM (Graviton) instances are roughly 20% cheaper than the x86 equivalent
    and Node, Postgres, and Redis all have first-class arm64 images.

    t4g.small is 2 vCPU / 2 GB — enough to run the API, Postgres, and Redis
    together for staging. t4g.micro (1 GB) will run out of memory once Postgres
    and the Node heap are both loaded.
  EOT
  type        = string
  default     = "t4g.small"
}

variable "root_volume_gb" {
  description = "Disk size. Holds the OS, Docker images, and the Postgres volume."
  type        = number
  default     = 30
}

variable "admin_cidr" {
  description = <<-EOT
    Who may reach SSH (port 22).

    Leave as-is to keep SSH closed entirely — the instance is managed through
    SSM Session Manager, which needs no open port and logs every session.
    Set to "x.x.x.x/32" only if you specifically need direct SSH.
  EOT
  type        = string
  default     = "127.0.0.1/32"
}

variable "domain_name" {
  description = <<-EOT
    Optional. Leave empty and the stack serves HTTPS on a CloudFront hostname
    (https://xxxx.cloudfront.net) with an AWS certificate, which is enough for
    iOS App Transport Security and TestFlight.

    Set it once you own a domain, and Caddy takes over TLS end to end.
  EOT
  type        = string
  default     = ""
}

variable "log_level" {
  description = "Pino log level on the server."
  type        = string
  default     = "info"
}
