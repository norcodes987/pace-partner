import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Singpass } from "@govtechsg/singpass-myinfo-oidc-helper";
import type { Algorithm } from "jsonwebtoken";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface VendoredJwk {
  use: string;
  alg: string;
  [key: string]: unknown;
}

// mockpass's own published test keypair (static/certs/oidc-v2-rp-secret.json from
// github.com/opengovsg/mockpass) -- not a secret, and never valid against real NDI.
const keySet = JSON.parse(
  readFileSync(path.join(__dirname, "../keys/oidc-v2-rp-secret.json"), "utf-8"),
) as { keys: VendoredJwk[] };

function findKey(use: "sig" | "enc"): VendoredJwk {
  const jwk = keySet.keys.find((k) => k.use === use);
  if (!jwk) {
    throw new Error(`No "${use}" key found in vendored keyset`);
  }
  return jwk;
}

export interface SingpassClientConfig {
  oidcConfigUrl: string;
  clientId: string;
  redirectUri: string;
}

export function createSingpassClient(config: SingpassClientConfig): Singpass.NdiOidcHelper {
  const sigJwk = findKey("sig");
  const encJwk = findKey("enc");

  return new Singpass.NdiOidcHelper({
    oidcConfigUrl: config.oidcConfigUrl,
    clientID: config.clientId,
    redirectUri: config.redirectUri,
    clientAssertionSignKey: {
      key: JSON.stringify(sigJwk),
      format: "json",
      alg: sigJwk.alg as Algorithm,
    },
    jweDecryptKey: {
      key: JSON.stringify(encJwk),
      format: "json",
    },
  });
}
