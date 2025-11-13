import { ConnectError, Code, createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { SickRockService } from './sickrock';

type Credentials = {
  username?: string;
  password?: string;
};

const buildAuthHeader = (credentials?: Credentials) => {
  if (!credentials?.username || !credentials.password) {
    return undefined;
  }

  const token = btoa(`${credentials.username}:${credentials.password}`);
  return `Basic ${token}`;
};

export const createSickRockClient = (
  baseUrl?: string,
  credentials?: Credentials,
  token?: string | null,
) =>
  createClient(
    SickRockService,
    createConnectTransport({
      baseUrl: baseUrl ?? '',
      interceptors: [
        (next) => async (req) => {
          const authHeader = token
            ? `Bearer ${token}`
            : buildAuthHeader(credentials);

          if (authHeader) {
            req.header.set('Authorization', authHeader);
          }

          try {
            return await next(req);
          } catch (error) {
            if (
              !token &&
              error instanceof ConnectError &&
              error.code === Code.Unauthenticated &&
              req.header.has('Authorization')
            ) {
              // If login fails with credentials, remove the header and retry
              req.header.delete('Authorization');
              return next(req);
            }
            throw error;
          }
        },
      ],
    }),
  );

