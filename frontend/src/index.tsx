import { Auth } from "@aws-amplify/auth";
import { GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DescribeTasksCommand, RunTaskCommand } from "@aws-sdk/client-ecs";
import { InvokeCommand } from '@aws-sdk/client-lambda';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload as S3Upload } from "@aws-sdk/lib-storage";
import { SyntheticEvent, useEffect, useState } from "react";
import { render } from "react-dom";
import { DropzoneInputProps, FileWithPath, useDropzone } from "react-dropzone";
import { Link, MemoryRouter, Route, Switch, useHistory, useParams } from "react-router-dom";
import { ecsClient, getSignedUrl, getUserEmail, lambdaClient, logsClient, s3Client } from "./aws";
import { useAsync } from "./hooks";

render(<App />, document.getElementById("app"));

function App() {
  return (
    <MemoryRouter>
      <div>
        <h1>DBP-ETL</h1>
        <nav>
          <Link to={{ pathname: "/", key: `${Math.random()}` }}>Upload</Link>
          {" | "}
          <Link to="/artifacts">Artifacts</Link>
          {" | "}
          <Link to={{ pathname: "/lpts" }}>LPTS</Link>
          {" | "}
          <button onClick={() => Auth.signOut()}>Sign Out</button>
        </nav>
        <Switch>
          <Route path="/artifacts">
            <Artifacts />
          </Route>
          <Route
            path="/retry/:uploadKey"
            render={({ location }) => <Upload key={location.key} />}
          />
          <Route path="/lpts">
            <LPTS />
          </Route>
          <Route
            path="/"
            render={({ location }) => <Upload key={location.key} />}
          />
        </Switch>
      </div>
    </MemoryRouter>
  );
}

function LPTS() {
  const [status, setStatus] = useState("");

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    async onDrop(acceptedFiles: FileWithPath[], fileRejections) {
      if (fileRejections.length > 0) {
        setStatus(fileRejections.map(rejection => rejection.errors.map(error => error.message).join('\n')).join('\n'));
        return;
      }
      console.log({ acceptedFiles });

      if (acceptedFiles.length !== 1) {
        setStatus('Must upload single file');
        return;
      }

      if (acceptedFiles[0].name !== 'qry_dbp4_Regular_and_NonDrama.xml') {
        setStatus('File should be named qry_dbp4_Regular_and_NonDrama.xml');
        return;
      }

      setStatus('Uploading...');

      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.UPLOAD_BUCKET,
        Key: 'qry_dbp4_Regular_and_NonDrama.xml',
        Body: acceptedFiles[0],
      }));

      setStatus('Finished Uploading');
    },
  });

  return (
    <div>
      <h2>LPTS</h2>
      <div {...getRootProps()}>
        <input {...getInputProps()} />
        <p>{isDragActive ? "Drop here" : "Drag here"}</p>
      </div>
      {status && (<p>{status}</p>)}
    </div>
  );
}

function Artifacts() {
  const state = useAsync(getRuns);

  const [page, setPage] = useState(1);

  return (
    <div>
      <h2>Artifacts</h2>
      {state.loading ? (
        <p>Loading...</p>
      ) : state.error ? (
        <p>Error: {state.error.message}</p>
      ) : (
        <>
          <button onClick={() => setPage(Math.max(1, page - 1))}>Prev</button>
          {" "}
          Page {page}
          {" "}
          <button onClick={() => setPage(Math.min(Math.round((state.value?.length || 0) / 10), page + 1))}>Next</button>
          <ul>
            {state.value
              ?.reverse()
              .slice((page - 1) * 10, page * 10)
              .map((key: string) => (
                <ArtifactFolder key={key} uploadKey={key} />
              ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ArtifactFolder({ uploadKey }: { uploadKey: string }) {
  const [metadata, setMetadata] = useState<{ [key: string]: string } | null>();
  const [artifacts, setArtifacts] = useState<{ key: string; url: string }[]>();
  const [uploadedFiles, setUploadedFiles] = useState<string[]>();
  const [logs, setLogs] = useState<string>();

  const history = useHistory();

  useEffect(() => {
    s3Client
      .send(
        new GetObjectCommand({
          Bucket: process.env.ARTIFACTS_BUCKET,
          Key: `${uploadKey}/metadata`,
        })
      )
      .then((x) => setMetadata(x.Metadata))
      .catch(_ => setMetadata(null));
  }, []);

  function toggle(e: SyntheticEvent<HTMLDetailsElement, Event>) {
    if (!e.currentTarget.open) return;
    if (artifacts === undefined) getArtifacts(uploadKey).then(setArtifacts);
    if (uploadedFiles === undefined) {
      s3Client
        .send(
          new ListObjectsV2Command({
            Bucket: process.env.UPLOAD_BUCKET,
            Prefix: uploadKey,
          })
        )
        .then((x) => setUploadedFiles(x.Contents?.map(x => x.Key!) || []));
    }
  }

  function toggleLogs(e: SyntheticEvent<HTMLDetailsElement, Event>) {
    if (!e.currentTarget.open) return;
    if (!metadata?.taskid) return;
    if (logs === undefined) {
      logsClient
        .send(
          new GetLogEventsCommand({
            logGroupName: "/ecs/dbp-etl",
            logStreamName: `dbp-etl/dbp-etl/${metadata.taskid}`,
          })
        )
        .then((x) => x.events!.map((event) => event.message).join("\n"))
        .then(setLogs);
    }
  }

  function retry(uploadKey: string) {
    history.push(`/retry/${uploadKey}`);
  }

  return (
    <li>
      <details onToggle={toggle}>
        <summary>
          {uploadKey}
          {metadata === undefined && ' Loading...'}
          {metadata === null && ' Missing metadata'}
          {metadata?.status && ` (${metadata?.status})`}
          {metadata?.path && (<><br />Path: {metadata?.path}</>)}
          {metadata?.user && (<><br />User: {metadata?.user}</>)}
        </summary>
        <dl>
          <dt>Artifacts</dt>
          {artifacts === undefined ? (
            <dd>Loading...</dd>
          ) : (
            artifacts.map(({ key, url }) => (
              <dd key={key}>
                <a href={url}>{key}</a>
              </dd>
            ))
          )}
        </dl>
        {metadata?.taskid && (
          <details onToggle={toggleLogs}>
            <summary>Logs</summary>
            <pre>
              {logs === undefined ? "Loading..." : logs || "No Logs Found"}
            </pre>
          </details>
        )}
        {uploadedFiles && uploadedFiles.length > 0 && (
          <>
            <details>
              <summary>
                <button onClick={() => retry(uploadKey)}>Retry</button>
                {" "}
                Uploaded Files
              </summary>
              <ul>
                {uploadedFiles?.map(x => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </details>
          </>
        )}
      </details>
    </li>
  );
}

function Upload() {
  const [showResults, setShowResults] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ecsTaskStatus, setEcsTaskStatus] = useState("");
  const [ecsLogs, setEcsLogs] = useState("");
  const [artifacts, setArtifacts] = useState<{ key: string; url: string }[]>(
    []
  );
  const [files, setFiles] = useState<FileWithPath[]>([]);
  const [prefix, setPrefix] = useState("");
  const [uploadingMessage, setUploadingMessage] = useState("");
  const [error, setError] = useState("");
  const [validations, setValidations] = useState<string[]>([]);

  const params = useParams<{ uploadKey: string }>();

  useEffect(() => {
    console.log('uploadKey', params.uploadKey);
    if (params.uploadKey) {
      (async () => {
        try {
          setShowResults(true);
          for await (const [status, logs] of runTask(params.uploadKey)) {
            setEcsTaskStatus(status);
            setEcsLogs(logs);
          }
          setArtifacts(await getArtifacts(params.uploadKey));
        } catch (e) {
          setError(e.message);
        }
      })();
    }
  }, []);

  function clear() {
    setFiles([]);
    setPrefix("");
    setValidations([]);
  }

  async function upload() {
    try {
      setUploading(true);
      const uploadKey = await uploadFiles(files, prefix, setUploadingMessage);
      setUploading(false);
      setShowResults(true);
      for await (const [status, logs] of runTask(uploadKey)) {
        setEcsTaskStatus(status);
        setEcsLogs(logs);
      }
      setArtifacts(await getArtifacts(uploadKey));
    } catch (e) {
      setError(e.message);
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop(acceptedFiles: FileWithPath[], fileRejections) {
      for (const rejection of fileRejections) {
        for (const error of rejection.errors) {
          console.error(error);
        }
      }
      if (acceptedFiles.length > 0) {
        const prefix = acceptedFiles
          .map((x) =>
            x
              .path!.split("/")
              .slice(0, -1)
              .filter((x) => x)
              .join("/")
          )
          .reduce((a: string, b: string) => {
            for (let i = a.length; i > 0; i--) {
              if (a.substring(0, i) === b.substring(0, i)) {
                return a.substring(0, i);
              }
            }
            return "";
          });
        setPrefix(prefix);
        setValidations(["Validating..."]);
        validate(prefix).then((validations) => {
          if (validations.length > 0) {
            setValidations(validations.map(validation => `${prefix} ${validation}`))
          } else {
            setValidations(["Passed Validation"]);
          }
        });
      } else {
        clear();
      }
      setFiles(acceptedFiles);
    },
  });

  if (error) {
    return <p>{error}</p>;
  }

  if (uploading) {
    return <p>{uploadingMessage}</p>;
  }

  if (showResults) {
    return (
      <div>
        <h2>Results</h2>
        <p>Task Status: {ecsTaskStatus}</p>
        <details open>
          <summary>Logs</summary>
          <pre>{ecsLogs}</pre>
        </details>
        <details open>
          <summary>Artifacts</summary>
          <ul>
            {artifacts.map(({ key, url }) => (
              <li key={key}>
                <a href={url}>{key}</a>
              </li>
            ))}
          </ul>
        </details>
      </div>
    );
  }

  return (
    <div>
      <h2>Upload</h2>
      <div {...getRootProps()}>
        <input
          {...getInputProps({ webkitdirectory: "true" } as DropzoneInputProps)}
        />
        <p>{isDragActive ? "Drop here" : "Drag here"}</p>
      </div>
      <label>
        Prefix: upload_aws/
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
      </label>
      <details>
        <summary>{files.length} Files</summary>
        <ul>
          {files.map((file) => (
            <li key={file.name}>{file.name}</li>
          ))}
        </ul>
      </details>
      <ul>
        {validations.map(validation => (
          <li key={validation}>
            {validation}
          </li>
        ))}
      </ul>
      <button disabled={!(files.length > 0)} onClick={clear}>
        Clear
      </button>
      <button disabled={!(files.length > 0 && prefix)} onClick={upload}>
        Upload
      </button>
    </div>
  );
}

async function* runTask(uploadKey: string) {
  const task = (
    await ecsClient.send(
      new RunTaskCommand({
        cluster: "dbp",
        taskDefinition: "dbp-etl",
        launchType: "FARGATE",
        platformVersion: "1.4.0",
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: JSON.parse(process.env.ECS_SUBNETS!),
            securityGroups: [process.env.ECS_SECURITY_GROUP!],
            assignPublicIp: "ENABLED",
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: "dbp-etl",
              environment: [
                {
                  name: "S3_KEY_PREFIX",
                  value: uploadKey,
                },
              ],
            },
          ],
        },
      })
    )
  ).tasks![0];

  const taskId = task.taskArn!.match(/task\/dbp\/(.+)$/)![1];

  await updateMetadata(uploadKey, { taskid: taskId });

  while (true) {
    const status = (
      await ecsClient.send(
        new DescribeTasksCommand({
          cluster: "dbp",
          tasks: [task.taskArn!],
        })
      )
    ).tasks![0].lastStatus!;

    if (["PROVISIONING", "PENDING"].includes(status)) {
      yield [status, ""];
    } else {
      try {
        const { events } = await logsClient.send(
          new GetLogEventsCommand({
            logGroupName: "/ecs/dbp-etl",
            logStreamName: `dbp-etl/dbp-etl/${taskId}`,
          })
        );
        const logs = events!.map((event) => event.message).join("\n");
        yield [status, logs];
        if (logs.includes("EXECUTION FINISHED")) return;
      } catch (e) {
        console.error(e);
        yield [status, ""];
      }
    }

    if (status === "STOPPED") return;

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function getRuns() {
  return (
    await s3Client.send(
      new ListObjectsV2Command({
        Bucket: process.env.ARTIFACTS_BUCKET,
        Delimiter: "/",
      })
    )
  ).CommonPrefixes?.map((x) => x.Prefix!.slice(0, -1));
}

async function getArtifacts(uploadKey: string) {
  const objects =
    (
      await s3Client.send(
        new ListObjectsV2Command({
          Bucket: process.env.ARTIFACTS_BUCKET,
          Prefix: uploadKey,
        })
      )
    ).Contents?.filter((x) => !x.Key?.endsWith("metadata")) || [];
  return Promise.all(
    objects.map(async (x) => ({
      key: x.Key!,
      url: await getSignedUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: process.env.ARTIFACTS_BUCKET,
          Key: x.Key!,
        })
      ),
    }))
  );
}

async function uploadFiles(
  files: FileWithPath[],
  path: string,
  setUploadingMessage: (uploadingMessage: string) => void
): Promise<string> {
  // %Y-%m-%d-%H-%M-%S
  const uploadKey = new Date()
    .toISOString()
    .replace(/T|:/g, "-")
    .replace(/\..+$/, "");

  let remaining = files.length;
  setUploadingMessage(`Uploading ${remaining} files`);

  await Promise.all(
    files.map(async (file) => {
      const upload = new S3Upload({
        client: s3Client,
        params: {
          Bucket: process.env.UPLOAD_BUCKET,
          Key: `${uploadKey}/${path}/${file.name}`,
          Body: file,
        },
      });
      upload.on("httpUploadProgress", (progress) => {
        setUploadingMessage(
          `Uploading ${remaining} files (${file.name}... (${(progress.loaded! / progress.total!) * 100}%))`
        );
      });
      try {
        await upload.done();
      } catch (e) {
        console.error(e);
        throw new Error(`Error uploading ${file.name}`);
      }
      setUploadingMessage(`Uploading ${--remaining} files`);
    })
  );

  setUploadingMessage(`Finished Uploading`);

  await updateMetadata(uploadKey, { path, user: await getUserEmail() }, true);
  return uploadKey;
}

async function updateMetadata(
  uploadKey: string,
  metadata: any,
  override = false
) {
  const existingMetadata =
    !override &&
    (
      await s3Client.send(
        new GetObjectCommand({
          Bucket: process.env.ARTIFACTS_BUCKET,
          Key: `${uploadKey}/metadata`,
        })
      )
    ).Metadata;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.ARTIFACTS_BUCKET,
      Key: `${uploadKey}/metadata`,
      Metadata: {
        ...existingMetadata,
        ...metadata,
      },
    })
  );
}

async function validate(uploadKey: string): Promise<string[]> {
  try {
    const result = await lambdaClient.send(new InvokeCommand({
      FunctionName: process.env.VALIDATE_LAMBDA,
      Payload: new TextEncoder().encode(JSON.stringify({ prefix: uploadKey })),
    }));
    return JSON.parse(new TextDecoder("utf-8").decode(result.Payload));
  } catch {
    return ["Error running validator"];
  }
}
