import { EnvValidationError, env, isTest, parseEnv } from '@config/env';

const VALID: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://kinvo:kinvo@localhost:5432/kinvo',
  REDIS_URL: 'redis://localhost:6379',
};

describe('environment validation (spec 7, Batch 0)', () => {
  it('parses a minimal valid environment', () => {
    const parsed = parseEnv(VALID);

    expect(parsed.NODE_ENV).toBe('production');
    expect(parsed.DATABASE_URL).toBe('postgresql://kinvo:kinvo@localhost:5432/kinvo');
  });

  it('applies documented defaults for optional variables', () => {
    const parsed = parseEnv(VALID);

    expect(parsed.PORT).toBe(3000);
    expect(parsed.HOST).toBe('0.0.0.0');
    expect(parsed.LOG_LEVEL).toBe('info');
    expect(parsed.JSON_BODY_LIMIT).toBe('1mb');
    expect(parsed.CORS_ORIGINS).toEqual(['*']);
  });

  it('crashes rather than booting half-configured when a required var is missing', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(EnvValidationError);
  });

  it('names every offending variable in the failure', () => {
    try {
      parseEnv({ NODE_ENV: 'production' });
      throw new Error('expected parseEnv to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(Object.keys(issues).sort()).toEqual(['DATABASE_URL', 'REDIS_URL']);
      expect((error as EnvValidationError).message).toContain('DATABASE_URL');
    }
  });

  it('rejects a DATABASE_URL that is not a postgres connection string', () => {
    expect(() => parseEnv({ ...VALID, DATABASE_URL: 'mysql://localhost:3306/kinvo' })).toThrow(
      EnvValidationError,
    );
  });

  it('accepts both postgres:// and postgresql:// schemes', () => {
    expect(parseEnv({ ...VALID, DATABASE_URL: 'postgres://u:p@h:5432/d' }).DATABASE_URL).toContain(
      'postgres://',
    );
  });

  it('rejects a REDIS_URL that is not a redis connection string', () => {
    expect(() => parseEnv({ ...VALID, REDIS_URL: 'http://localhost:6379' })).toThrow(
      EnvValidationError,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => parseEnv({ ...VALID, NODE_ENV: 'staging' })).toThrow(EnvValidationError);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => parseEnv({ ...VALID, LOG_LEVEL: 'chatty' })).toThrow(EnvValidationError);
  });

  it('coerces PORT from its string environment value', () => {
    expect(parseEnv({ ...VALID, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a PORT that is not a usable number', () => {
    expect(() => parseEnv({ ...VALID, PORT: 'not-a-port' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ ...VALID, PORT: '70000' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ ...VALID, PORT: '0' })).toThrow(EnvValidationError);
  });

  it('splits and trims a comma-separated CORS_ORIGINS list', () => {
    const parsed = parseEnv({
      ...VALID,
      CORS_ORIGINS: 'https://admin.kinvo.app, https://kinvo.app ,',
    });

    expect(parsed.CORS_ORIGINS).toEqual(['https://admin.kinvo.app', 'https://kinvo.app']);
  });

  it('exposes the parsed singleton for the current process', () => {
    expect(env.NODE_ENV).toBe('test');
    expect(isTest).toBe(true);
  });
});
