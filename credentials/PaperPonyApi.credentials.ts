import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  Icon,
  INodeProperties,
} from 'n8n-workflow';

/**
 * The key goes in the Authorization header and nowhere else. It is never put in
 * a URL, never echoed into an error, and n8n stores it encrypted.
 *
 * The `test` block is the reason this file matters more than it looks. Without
 * it the first sign of a wrong key is a red step halfway through building a
 * workflow; with it, n8n calls `GET /v1/account` the moment the credential is
 * saved and says so on the spot. For an audience that will not read an API
 * reference, that is the difference between a key problem and a mystery.
 */
export class PaperPonyApi implements ICredentialType {
  name = 'paperPonyApi';

  displayName = 'PaperPony API';

  /**
   * The same badge as the node. Indigo 600 on a light background and indigo 400
   * on a dark one: the darker tile goes muddy against n8n's dark theme, and the
   * lighter one is washed out against the light.
   */
  icon: Icon = { light: 'file:paperpony.svg', dark: 'file:paperpony.dark.svg' };

  /**
   * `/docs`, and not `/docs/integrations/n8n`, because that page does not exist
   * yet. A link in a shipped package that answers 404 is the defect this file
   * is most likely to carry, and the fix is to point at what is live rather
   * than at what is planned. It moves when the page does, which
   * `docs/integrations/n8n.md` lists as a step before publishing.
   */
  documentationUrl = 'https://paperpony.dev/docs';

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'Create one at app.paperpony.dev/keys. The key is shown once when you create it and cannot be read again afterwards, so copy it before you close the page.',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://api.paperpony.dev',
      description:
        'The PaperPony API to call. Leave this as it is. It exists so PaperPony can point you somewhere else while a problem is being looked at.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  };

  /**
   * `GET /v1/account` rather than `/v1/health`: health is unauthenticated and
   * would answer 200 for a key that is revoked, wrong, or blank. A credential
   * test that passes with no credential is worse than none, because it teaches
   * the reader that the check means something.
   */
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/v1/account',
    },
  };
}
