# Access Kit CLI

`rebac` is the operator CLI for the Access Kit ReBAC control plane. It calls the API over HTTP and does not evaluate authorization locally.

## Install

```sh
npm install -g @access-kit/cli
```

## Configure

Use environment variables for local development:

```sh
export REBAC_API_URL=http://127.0.0.1:3000
export REBAC_API_KEY_ENV=REBAC_API_KEY
export REBAC_API_KEY=local-development-token
```

Profiles can live in a JSON file referenced by `REBAC_CLI_CONFIG` or `--config`:

```json
{
  "profiles": {
    "local": {
      "apiUrl": "http://127.0.0.1:3000",
      "apiKeyEnv": "REBAC_API_KEY"
    }
  }
}
```

## Run

```sh
rebac --profile local check user:alice read document:case-plan
rebac --preview --diff provision plan user:alice document:case-plan read --connector mock
rebac completion bash
```

CLI output is one JSON object per command unless a local helper such as `completion` intentionally writes shell text.
