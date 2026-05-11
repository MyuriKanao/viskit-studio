import createClient, { type Client } from 'openapi-fetch';

import type { paths } from '../../../../packages/schemas/ts/api-paths';

export type ApiClient = Client<paths>;

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export const apiClient: ApiClient = createClient<paths>({ baseUrl });
