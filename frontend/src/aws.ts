import { Auth } from "@aws-amplify/auth";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { ECSClient } from "@aws-sdk/client-ecs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";

export { getSignedUrl } from "@aws-sdk/s3-request-presigner";

Auth.configure({
  region: process.env.AWS_REGION,
  identityPoolId: process.env.COGNITO_IDENTITY_POOL_ID,
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  userPoolWebClientId: process.env.COGNITO_USER_POOL_CLIENT_ID,
  oauth: {
    domain: process.env.COGNITO_DOMAIN,
    redirectSignIn: window.location.origin,
    redirectSignOut: window.location.origin,
    responseType: "code",
  },
});

Auth.currentAuthenticatedUser()
  .then(() => Auth.currentCredentials())
  .catch(() => Auth.federatedSignIn());

const credentials = async () => {
  const credentials = await Auth.currentCredentials();
  if (credentials instanceof Error) {
    throw credentials;
  }
  return credentials;
};

export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials,
});
export const ecsClient = new ECSClient({
  region: process.env.AWS_REGION,
  credentials,
});
export const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION,
  credentials,
});
export const logsClient = new CloudWatchLogsClient({
  region: process.env.AWS_REGION,
  credentials,
});

export function getUserEmail(): Promise<string> {
  return Auth.currentSession().then((x) => x.getIdToken().payload.email);
}
