import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

type Manifest = Record<string, unknown>;

const root = process.cwd();

const kustomization = await readManifest("deploy/kubernetes/kustomization.yaml");
const namespace = await readManifest("deploy/kubernetes/namespace.yaml");
const serviceAccount = await readManifest("deploy/kubernetes/service-account.yaml");
const configMap = await readManifest("deploy/kubernetes/configmap.yaml");
const pvc = await readManifest("deploy/kubernetes/persistent-volume-claim.yaml");
const deployment = await readManifest("deploy/kubernetes/deployment.yaml");
const service = await readManifest("deploy/kubernetes/service.yaml");
const networkPolicy = await readManifest("deploy/kubernetes/network-policy.yaml");
const signedImagePolicy = await readManifest("deploy/policies/kyverno/rebac-api-signed-image-policy.yaml");

requireKind(kustomization, "Kustomization", "kustomization");
requireKind(namespace, "Namespace", "namespace");
requireKind(serviceAccount, "ServiceAccount", "service account");
requireKind(configMap, "ConfigMap", "config map");
requireKind(pvc, "PersistentVolumeClaim", "persistent volume claim");
requireKind(deployment, "Deployment", "deployment");
requireKind(service, "Service", "service");
requireKind(networkPolicy, "NetworkPolicy", "network policy");
requireKind(signedImagePolicy, "ClusterPolicy", "signed-image admission policy");

const resources = asStringArray(kustomization.resources, "kustomization resources");
for (const resource of [
  "namespace.yaml",
  "service-account.yaml",
  "configmap.yaml",
  "persistent-volume-claim.yaml",
  "deployment.yaml",
  "service.yaml",
  "network-policy.yaml"
]) {
  requireIncludes(resources, resource, "kustomization resources");
}

const namespaceLabels = asRecord(asRecord(namespace.metadata, "namespace metadata").labels, "namespace labels");
requireEquals(namespaceLabels["pod-security.kubernetes.io/enforce"], "restricted", "namespace pod security enforce label");

requireEquals(serviceAccount.automountServiceAccountToken, false, "service account token automount");

const configData = asRecord(configMap.data, "config map data");
requireEquals(configData.REBAC_API_HOST, "0.0.0.0", "REBAC_API_HOST");
requireEquals(configData.REBAC_API_PORT, "3000", "REBAC_API_PORT");
requireEquals(configData.REBAC_STATE_PATH, "/var/lib/access-kit/state/runtime-state.json", "REBAC_STATE_PATH");
requireEquals(configData.REBAC_EVIDENCE_ROOT, "/var/lib/access-kit/evidence", "REBAC_EVIDENCE_ROOT");

const pvcSpec = asRecord(pvc.spec, "pvc spec");
requireIncludes(asStringArray(pvcSpec.accessModes, "pvc access modes"), "ReadWriteOnce", "pvc access modes");

const deploymentSpec = asRecord(deployment.spec, "deployment spec");
requireEquals(deploymentSpec.replicas, 1, "deployment replicas");

const podSpec = asRecord(
  asRecord(asRecord(deploymentSpec.template, "deployment template").spec, "pod spec"),
  "pod spec"
);
requireEquals(podSpec.serviceAccountName, "rebac-api", "pod service account");
requireEquals(podSpec.automountServiceAccountToken, false, "pod token automount");

const podSecurityContext = asRecord(podSpec.securityContext, "pod security context");
requireEquals(podSecurityContext.runAsNonRoot, true, "pod runAsNonRoot");
requireEquals(podSecurityContext.runAsUser, 1000, "pod runAsUser");
requireEquals(asRecord(podSecurityContext.seccompProfile, "pod seccomp profile").type, "RuntimeDefault", "pod seccomp");

const container = findNamedRecord(asArray(podSpec.containers, "containers"), "rebac-api", "container");
requireIncludes(String(container.image), "@sha256:", "container image digest");
if (String(container.image).includes(":latest")) {
  throw new Error("container image must not use latest tag");
}

const containerSecurityContext = asRecord(container.securityContext, "container security context");
requireEquals(containerSecurityContext.allowPrivilegeEscalation, false, "container privilege escalation");
requireEquals(containerSecurityContext.readOnlyRootFilesystem, true, "container read-only root filesystem");
requireIncludes(
  asStringArray(asRecord(containerSecurityContext.capabilities, "container capabilities").drop, "dropped capabilities"),
  "ALL",
  "dropped capabilities"
);

requireProbe(container, "readinessProbe", "/v1/ready");
requireProbe(container, "livenessProbe", "/v1/health");
requireProbe(container, "startupProbe", "/v1/health");

const env = asArray(container.env, "container env");
requireConfigEnv(env, "REBAC_API_HOST");
requireConfigEnv(env, "REBAC_API_PORT");
requireConfigEnv(env, "REBAC_API_ACTOR");
requireConfigEnv(env, "REBAC_STATE_PATH");
requireConfigEnv(env, "REBAC_EVIDENCE_ROOT");
requireSecretEnv(env, "REBAC_API_KEYS", "rebac-api-auth", "bearer-tokens");

const volumeMount = findRecordByField(asArray(container.volumeMounts, "volume mounts"), "mountPath", "/var/lib/access-kit", "volume mount");
requireEquals(volumeMount.name, "rebac-api-data", "state volume mount name");

const stateVolume = findNamedRecord(asArray(podSpec.volumes, "pod volumes"), "rebac-api-data", "state volume");
requireEquals(
  asRecord(stateVolume.persistentVolumeClaim, "state persistent volume claim").claimName,
  "rebac-api-data",
  "state claim name"
);

const serviceSpec = asRecord(service.spec, "service spec");
requireEquals(serviceSpec.type, "ClusterIP", "service type");
const servicePort = findNamedRecord(asArray(serviceSpec.ports, "service ports"), "http", "service port");
requireEquals(servicePort.port, 3000, "service port");
requireEquals(servicePort.targetPort, "http", "service target port");

const networkPolicySpec = asRecord(networkPolicy.spec, "network policy spec");
requireIncludes(asStringArray(networkPolicySpec.policyTypes, "network policy types"), "Ingress", "network policy types");
requireIncludes(asStringArray(networkPolicySpec.policyTypes, "network policy types"), "Egress", "network policy types");

const signedImagePolicyText = JSON.stringify(signedImagePolicy);
for (const required of [
  "verifyImages",
  "verifyDigest",
  "mutateDigest",
  "keyless",
  "https://token.actions.githubusercontent.com",
  "container-release.yml",
  "rebac-api-v.*"
]) {
  requireIncludes(signedImagePolicyText, required, "signed-image admission policy");
}

console.log("Validated deployable API Kubernetes manifests.");
console.log("PASS Kubernetes manifests wire health/readiness probes, persistent state, secret references, and restricted runtime security.");
console.log("PASS Admission policy requires immutable GHCR digests and keyless release signatures for rebac-api images.");

async function readManifest(path: string): Promise<Manifest> {
  const contents = await readFile(join(root, path), "utf8");
  const parsed = YAML.parse(contents) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`${path} did not parse to an object`);
  }

  return parsed;
}

function requireKind(manifest: Manifest, kind: string, label: string): void {
  requireEquals(manifest.kind, kind, `${label} kind`);
}

function requireProbe(container: Manifest, probeName: string, path: string): void {
  const probe = asRecord(container[probeName], probeName);
  const httpGet = asRecord(probe.httpGet, `${probeName} httpGet`);
  requireEquals(httpGet.path, path, `${probeName} path`);
  requireEquals(httpGet.port, "http", `${probeName} port`);
}

function requireConfigEnv(env: unknown[], name: string): void {
  const entry = findNamedRecord(env, name, `${name} env`);
  const configMapKeyRef = asRecord(asRecord(entry.valueFrom, `${name} valueFrom`).configMapKeyRef, `${name} configMapKeyRef`);
  requireEquals(configMapKeyRef.name, "rebac-api-config", `${name} config map name`);
  requireEquals(configMapKeyRef.key, name, `${name} config map key`);
}

function requireSecretEnv(env: unknown[], name: string, secretName: string, key: string): void {
  const entry = findNamedRecord(env, name, `${name} env`);
  const secretKeyRef = asRecord(asRecord(entry.valueFrom, `${name} valueFrom`).secretKeyRef, `${name} secretKeyRef`);
  requireEquals(secretKeyRef.name, secretName, `${name} secret name`);
  requireEquals(secretKeyRef.key, key, `${name} secret key`);
}

function findNamedRecord(values: unknown[], name: string, label: string): Manifest {
  return findRecordByField(values, "name", name, label);
}

function findRecordByField(values: unknown[], field: string, expected: string, label: string): Manifest {
  const match = values.find((value) => isRecord(value) && value[field] === expected);

  if (!isRecord(match)) {
    throw new Error(`Missing ${label} with ${field}=${expected}`);
  }

  return match;
}

function requireIncludes(values: string[] | string, needle: string, label: string): void {
  if (typeof values === "string") {
    if (!values.includes(needle)) {
      throw new Error(`${label} is missing required text: ${needle}`);
    }
    return;
  }

  if (!values.includes(needle)) {
    throw new Error(`${label} is missing required entry: ${needle}`);
  }
}

function requireEquals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)} but found ${String(actual)}`);
  }
}

function asRecord(value: unknown, label: string): Manifest {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  return value;
}

function asStringArray(value: unknown, label: string): string[] {
  const array = asArray(value, label);

  if (!array.every((entry): entry is string => typeof entry === "string")) {
    throw new Error(`${label} must be a string array`);
  }

  return array;
}

function isRecord(value: unknown): value is Manifest {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
