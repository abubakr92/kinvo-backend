import { Router, type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';

import { env } from '@config/env';
import { buildOpenApiDocument } from './openapi';

/**
 * Browsable API documentation.
 *
 * Served by the API itself rather than uploaded anywhere, so it is always the
 * documentation for the code that is actually running. The Flutter team can
 * also point an OpenAPI generator at /docs/openapi.json and generate Dart
 * models and a client instead of hand-writing request and response classes.
 */
export const docsRouter: Router = Router();

/**
 * The server URL is derived from the incoming request rather than configured.
 *
 * Behind CloudFront the API cannot know its own public hostname, and a
 * hardcoded one means "Try it out" fires at the wrong host the moment a domain
 * is added.
 */
function serverUrlFrom(req: Request): string {
  const proto = req.get('x-forwarded-proto') ?? req.protocol;
  const host = req.get('x-forwarded-host') ?? req.get('host') ?? 'localhost';
  return `${proto}://${host}`;
}

docsRouter.get('/openapi.json', (req: Request, res: Response) => {
  // Not the standard envelope: this is an OpenAPI document, and every tool that
  // consumes one expects it at the top level.
  res.json(buildOpenApiDocument(serverUrlFrom(req)));
});

docsRouter.use(
  '/',
  swaggerUi.serve,
  (req: Request, res: Response, next: (err?: unknown) => void) => {
    const handler = swaggerUi.setup(buildOpenApiDocument(serverUrlFrom(req)), {
      customSiteTitle: 'Kinvo API',
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 0,
        tryItOutEnabled: true,
      },
    });

    handler(req, res, next);
  },
);

export const DOCS_ENABLED = env.DOCS_ENABLED;
