import { Auth } from "@aws-amplify/auth";
import { GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DescribeTasksCommand, RunTaskCommand } from "@aws-sdk/client-ecs";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload as S3Upload } from "@aws-sdk/lib-storage";
import { Suspense, SyntheticEvent, useEffect, useState } from "react";
import { render } from "react-dom";
import { DropzoneInputProps, FileWithPath, useDropzone } from "react-dropzone";
import { ErrorBoundary } from "react-error-boundary";
import {
  Link,
  MemoryRouter,
  Route,
  Switch,
  useHistory,
  useParams,
} from "react-router-dom";
import { RecoilRoot } from "recoil";
import {
  ecsClient,
  getSignedUrl,
  getUserEmail,
  lambdaClient,
  logsClient,
  s3Client,
} from "./aws";
import { useAsync } from "./hooks";
import { debounce } from "debounce";
import bibleBrain from "./BibleBrain.svg";
import pLimit from 'p-limit';

render(<App />, document.getElementById("app"));

function App() {
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => {
        return (
          <>
            <h3>An error has occured</h3>
            <button onClick={() => resetErrorBoundary()}>Retry</button>
            <pre>{error.stack}</pre>
          </>
        );
      }}
    >
      <RecoilRoot>
        <MemoryRouter>
          <Suspense fallback={"Loading..."}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <img src={bibleBrain} style={{ maxWidth: '20rem' }} />
              <h3>DBP ETL Web v{process.env.VERSION}</h3>
              <nav>
                <Link to={{ pathname: "/", key: `${Math.random()}` }}>Upload</Link>
                {" | "}
                <Link to="/artifacts">Artifacts</Link>
                {" | "}
                <Link to="/postvalidate">Postvalidate</Link>
                {" | "}
                <button onClick={() => Auth.signOut()}>Sign Out</button>
              </nav>
              <Switch>
                <Route path="/artifacts">
                  <Artifacts />
                </Route>
                <Route path="/postvalidate">
                  <Postvalidate />
                </Route>
                <Route
                  path="/retry/:uploadKey"
                  render={({ location }) => <Upload key={location.key} />}
                />
                <Route
                  path="/"
                  render={({ location }) => <Upload key={location.key} />}
                />
              </Switch>
            </div>
          </Suspense>
        </MemoryRouter>
      </RecoilRoot>
    </ErrorBoundary>
  );
}

function Postvalidate() {
  const [postvalidate, setPostvalidate] = useState("");
  const [output, setOutput] = useState("");
  return (
    <div>
      <h2>Postvalidate</h2>
      <input
        value={postvalidate}
        onChange={(event) => {
          setPostvalidate(event.target.value);
          runPostvalidate(event.target.value, setOutput);
        }}
        placeholder="Postvalidate"
      />
      <br />
      {output && (
        <iframe
          srcDoc={output}
          style={{ width: "100%" }}
          scrolling={"no"}
          onLoad={(e) => {
            console.log(e.target);
            e.target.style.height = `${e.target.contentWindow.document.body.scrollHeight + 20}px`;
            e.target.style.width = `${e.target.contentWindow.document.body.scrollWidth + 20}px`;
          }}
        />
      )}
    </div>
  );
}

function Artifacts() {
  const state = useAsync(getRuns);

  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");

  if (state.loading) {
    return (
      <div>
        <h2>Artifacts</h2>
        <p>Loading...</p>
      </div>
    );
  } else if (state.error) {
    return (
      <div>
        <h2>Artifacts</h2>
        <p>Error: {state.error.message}</p>
      </div>
    );
  }

  const runs = state.value.filter(
    (x) =>
      !filter ||
      x.prefix.includes(filter.toLowerCase()) ||
      (x.metadata &&
        JSON.stringify(x.metadata).toLowerCase().includes(filter.toLowerCase()))
  );

  console.log({ runs });

  const recordsPerPage = 25;
  return (
    <div>
      <h2>Artifacts</h2>
      {state.loading ? (
        <p>Loading...</p>
      ) : state.error ? (
        <p>Error: {state.error.message}</p>
      ) : (
        <>
          <button onClick={() => setPage(Math.max(1, page - 1))}>Prev</button>{" "}
          Page {page} of {Math.ceil((runs.length || 1) / recordsPerPage)}{" "}
          <button
            onClick={() =>
              setPage(
                Math.min(
                  Math.ceil((runs.length || 1) / recordsPerPage),
                  page + 1
                )
              )
            }
          >
            Next
          </button>{" "}
          <input
            value={filter}
            onChange={(e) => {
              setPage(1);
              setFilter(e.target.value);
            }}
            placeholder="Filter"
          />
          <table border="1">
            <thead>
              <tr>
                <th>Date</th>
                <th>Folder</th>
                <th>User</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs
                .slice((page - 1) * recordsPerPage, page * recordsPerPage)
                .map(({ prefix, metadata }) => (
                  <ArtifactFolder
                    key={prefix}
                    prefix={prefix}
                    metadata={metadata}
                  />
                ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function ArtifactFolder({ prefix, metadata }: { prefix: any; metadata: any }) {
  const [artifacts, setArtifacts] = useState<{ key: string; url: string }[]>();
  const [uploadedFiles, setUploadedFiles] = useState<string[]>();
  const [logs, setLogs] = useState<string>();

  const history = useHistory();

  const [open, setOpen] = useState(false);

  function toggle() {
    setOpen(!open);
    if (open) return;
    if (artifacts === undefined) getArtifacts(prefix).then(setArtifacts);
    if (uploadedFiles === undefined) {
      s3Client
        .send(
          new ListObjectsV2Command({
            Bucket: process.env.UPLOAD_BUCKET,
            Prefix: prefix,
          })
        )
        .then((x) => setUploadedFiles(x.Contents?.map((x) => x.Key!) || []));
    }
  }

  function refreshLogs() {
    setLogs(undefined);
    logsClient
      .send(
        new GetLogEventsCommand({
          logGroupName: `/ecs/${process.env.ECS_CLUSTER}`,
          logStreamName: `dbp-etl/dbp-etl/${metadata.taskid}`,
        })
      )
      .then((x) => x.events!.map((event) => event.message).join("\n"))
      .then(setLogs);
  }

  function toggleLogs(e: SyntheticEvent<HTMLDetailsElement, Event>) {
    if (!e.currentTarget.open) return;
    if (!metadata?.taskid) return;
    if (logs === undefined) refreshLogs();
  }

  function retry(uploadKey: string) {
    history.push(`/retry/${uploadKey}`);
  }

  const [year, month, day, hour, minute, second] = prefix.split("-");
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);

  return (
    <>
      <tr onClick={() => toggle()}>
        <td style={{ whiteSpace: "nowrap" }}>{date.toLocaleString()}</td>
        {!metadata ? (
          <td colSpan="3">Missing metadata</td>
        ) : (
          <>
            <td style={{ whiteSpace: "nowrap" }}>{metadata?.path}</td>
            <td style={{ whiteSpace: "nowrap" }}>{metadata?.user}</td>
            <td>{metadata?.status}</td>
          </>
        )}
      </tr>
      {open && (
        <tr>
          <td colSpan="4">
            <dl>
              <dt>Artifacts</dt>
              {artifacts === undefined ? (
                <dd>Loading...</dd>
              ) : (
                artifacts.map(({ key, url }) => (
                  <dd key={key}>
                    <a href={url} target="_blank">{key}</a>
                  </dd>
                ))
              )}
            </dl>
            {metadata?.taskid && (
              <details onToggle={toggleLogs}>
                <summary>
                  <button onClick={() => refreshLogs()}>Refresh</button> Logs
                </summary>
                <pre style={{ whiteSpace: "pre-wrap", maxWidth: "100%" }}>
                  {logs === undefined ? "Loading..." : logs || "No Logs Found"}
                </pre>
              </details>
            )}
            {uploadedFiles && uploadedFiles.length > 0 && (
              <>
                <details>
                  <summary>
                    <button onClick={() => retry(prefix)}>Retry</button>{" "}
                    Uploaded Files
                  </summary>
                  <ul>
                    {uploadedFiles?.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </details>
              </>
            )}
          </td>
        </tr>
      )}
    </>
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
  const [uploadingMessage, setUploadingMessage] = useState("");
  const [error, setError] = useState("");
  const [prevalidate, setPrevalidate] = useState("");
  const [validations, setValidations] = useState<string[]>([]);

  const params = useParams<{ uploadKey: string }>();

  useEffect(() => {
    if (params.uploadKey) {
      (async () => {
        try {
          setShowResults(true);
          for await (const [status, logs] of runTask(params.uploadKey, [
            {
              name: "S3_KEY_PREFIX",
              value: params.uploadKey,
            },
          ])) {
            setEcsTaskStatus(status);
            setEcsLogs(logs);
          }
          setArtifacts(await getArtifacts(params.uploadKey));
        } catch (e) {
          console.log('Error (358):', e);
          setError(e.message);
        }
      })();
    }
  }, []);

  function clear() {
    setFiles([]);
    setValidations([]);
  }

  async function upload() {
    try {
      setUploading(true);
      const uploadKey = await uploadFiles(files, setUploadingMessage);
      setUploading(false);
      setShowResults(true);
      console.log("returned from uploadFiles... uploadKey:", uploadKey) // FIXME remove
      for await (const [status, logs] of runTask(uploadKey, [
        {
          name: "S3_KEY_PREFIX",
          value: uploadKey,
        },
      ])) {
        console.log("calling setEcsTaskStatus with status: ", status) // FIXME remove

        setEcsTaskStatus(status);
        setEcsLogs(logs);
      }
      setArtifacts(await getArtifacts(uploadKey));
    } catch (e) {
      console.log('error (387):', e);      
      setError(e.message);
    }
  }

  async function uploadLpts(file: FileWithPath) {
    try {
      setUploading(true);
      const uploadKey = await uploadLptsFile(file, setUploadingMessage);
      setUploading(false);
      setShowResults(true);
      for await (const [status, logs] of runTask(uploadKey, [
        {
          name: "S3_KEY_PREFIX",
          value: uploadKey,
        },
        {
          name: "LPTS_UPLOAD",
          value: "true",
        },
      ])) {
        setEcsTaskStatus(status);
        setEcsLogs(logs);
      }
      setArtifacts(await getArtifacts(uploadKey));
    } catch (e) {
      console.log('Error in uploadLpts (413):', e);
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
      setValidations([]);
      if (acceptedFiles[0].name === "lpts-dbp.xml") {
        uploadLpts(acceptedFiles[0]);
      } else if (acceptedFiles.length > 0) {
        const commonPath = findCommonPath(acceptedFiles);
        setPrevalidate(commonPath);
        runPrevalidate(
          [commonPath],
          acceptedFiles.map((x) => x.name),
          setValidations
        );
        setFiles(acceptedFiles);
      } else {
        clear();
      }
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
      <CompleteCheck />
      <h2>Upload</h2>
      <input
        value={prevalidate}
        onChange={(event) => {
          setPrevalidate(event.target.value);
          runPrevalidate(event.target.value.split(","), [], setValidations);
        }}
        placeholder="Prevalidate"
      />
      <div {...getRootProps()}>
        <input
          {...getInputProps({ webkitdirectory: "true" } as DropzoneInputProps)}
        />
        <p>{isDragActive ? "Drop here" : "Drag here"}</p>
      </div>
      {files.length > 0 && (
        <details>
          <summary>{files.length} Files</summary>
          <ul>
            {files.map((file) => (
              <li key={file.path}>{file.path}</li>
            ))}
          </ul>
        </details>
      )}
      <ul>
        {validations.map((validation) => (
          <li key={validation}>{validation}</li>
        ))}
      </ul>
      <button disabled={!(files.length > 0)} onClick={clear}>
        Clear
      </button>
      <button disabled={!(files.length > 0)} onClick={upload}>
        Upload
      </button>
    </div>
  );
}

function findCommonPath(acceptedFiles: FileWithPath[]) {
  return acceptedFiles
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
}

async function* runTask(
  uploadKey: string,
  environment: { name: string; value: string }[]
) {
  console.log("runTask.. uploadKey: ", uploadKey, ", environment: ", environment) // FIXME remove
  console.log("runTask.. cluster: ", process.env.ECS_CLUSTER, ", taskDefinition: ", process.env.ECS_TASK) // FIXME remove
  console.log("runTask.. ecs subnets: ", process.env.ECS_SUBNETS, ", security groups: ", [process.env.ECS_SECURITY_GROUP!]) // FIXME remove

  const task = (
    await ecsClient.send(
      new RunTaskCommand({
        cluster: process.env.ECS_CLUSTER,
        taskDefinition: process.env.ECS_TASK,
        launchType: "FARGATE",
        platformVersion: "1.4.0",
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: [process.env.ECS_SUBNETS!],
            securityGroups: [process.env.ECS_SECURITY_GROUP!],
            assignPublicIp: "ENABLED",
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: "dbp-etl",
              environment,
            },
          ],
        },
      })
    )
  ).tasks![0];

  const taskId = task.taskArn!.match(/task\/.+\/(.+)$/)![1];

  await updateMetadata(uploadKey, { taskid: taskId });

  while (true) {
    const status = (
      await ecsClient.send(
        new DescribeTasksCommand({
          cluster: process.env.ECS_CLUSTER,
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
            logGroupName: `/ecs/${process.env.ECS_CLUSTER}`,
            logStreamName: `dbp-etl/dbp-etl/${taskId}`,
          })
        );
        const logs = events!.map((event) => event.message).join("\n");
        if (logs.includes("EXECUTION FINISHED")) {
          yield ["STOPPED", logs];
          return;
        } else {
          yield [status, logs];
        }
      } catch (e) {
        console.log('Error in runTask (598):', e);
        yield [status, ""];
      }
    }

    if (status === "STOPPED") return;

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function getRuns() {
  let ContinuationToken: string | undefined;
  let runs: { prefix: string; metadata?: any }[] = [];

  do {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: process.env.ARTIFACTS_BUCKET,
        Delimiter: "/",
        ContinuationToken,
      })
    );
    ContinuationToken = response.NextContinuationToken;

    runs.push(
      ...(await Promise.all(
        (response.CommonPrefixes?.map((x) => x.Prefix!.slice(0, -1)) || []).map(
          async (prefix) => {
            const localStorageItem = localStorage.getItem(prefix);
            if (localStorageItem === "MISSING") {
              return { prefix };
            }
            if (localStorageItem) {
              return {
                prefix,
                metadata: JSON.parse(localStorageItem),
              };
            }
            const metadata = await new Promise<string>((resolve) => {
              s3Client
                .send(
                  new GetObjectCommand({
                    Bucket: process.env.ARTIFACTS_BUCKET,
                    Key: `${prefix}/metadata`,
                  })
                )
                .then((x) => resolve(JSON.stringify(x.Metadata)))
                .catch((_) => resolve("MISSING"));
            });
            {
              const [year, month, day, hour, minute, second] = prefix.split(
                "-"
              );
              const date = new Date(
                `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
              );
              date.setDate(date.getDate() + 1);
              if (date < new Date()) localStorage.setItem(prefix, metadata);
            }
            return {
              prefix,
              metadata:
                metadata !== "MISSING" ? JSON.parse(metadata) : undefined,
            };
          }
        )
      ))
    );
  } while (ContinuationToken);
  console.log({ runs });

  return runs.sort().reverse();
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
  setUploadingMessage: (uploadingMessage: string) => void
): Promise<string> {
  // %Y-%m-%d-%H-%M-%S
  const uploadKey = new Date()
    .toISOString()
    .replace(/T|:/g, "-")
    .replace(/\..+$/, "");

  let remaining = files.length;
  setUploadingMessage(`Uploading ${remaining} files`);

  if (files.some((file) => !file.path || !file.path.startsWith("/"))) {
    throw new Error("File paths must start /. Did you drag and drop a folder?");
  }

  const limit = pLimit(25);

  await Promise.all(
    files.map((file) => limit(async () => {
      const upload = new S3Upload({
        client: s3Client,
        params: {
          Bucket: process.env.UPLOAD_BUCKET,
          Key: `${uploadKey}${file.path}`,
          Body: file,
          //ExtraArgs: {'ACL': 'bucket-owner-full-control'}
        },
      });
      upload.on("httpUploadProgress", (progress) => {
        setUploadingMessage(
          `Uploading ${remaining} files (${file.name}... (${Math.round(
            (progress.loaded! / progress.total!) * 100
          )}%))`
        );
      });
      try {
        await upload.done();
      } catch (e) {
        console.error(`Error uploading ${uploadKey}${file.path}`, e);
        throw new Error(`Error uploading ${uploadKey}${file.path}`);
      }
      setUploadingMessage(`Uploading ${--remaining} files`);
    }))
  );

  setUploadingMessage(`Finished Uploading`);

  const path = findCommonPath(files);
  await updateMetadata(uploadKey, { path, user: await getUserEmail() }, true);
  console.log("finished uploading. uploadKey:", uploadKey) // FIXME remove
  return uploadKey;
}

async function uploadLptsFile(
  file: FileWithPath,
  setUploadingMessage: (uploadingMessage: string) => void
) {
  setUploadingMessage(`Uploading LPTS file`);

  const uploadKey = new Date()
    .toISOString()
    .replace(/T|:/g, "-")
    .replace(/\..+$/, "");

  const upload = new S3Upload({
    client: s3Client,
    params: {
      Bucket: process.env.UPLOAD_BUCKET,
      Key: `${uploadKey}/lpts-dbp.xml`,
      Body: file,
    },
  });
  try {
    await upload.done();
  } catch (e) {
    console.log(`Error uploading ${file.name}`, e);
    throw new Error(`Error uploading ${file.name}`);
  }

  setUploadingMessage(`Finished Uploading`);

  await updateMetadata(uploadKey, { user: await getUserEmail() }, true);
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

let lastPrevalidate: number;
const runPrevalidate = debounce(
  async (
    prefixes: string[],
    files: string[],
    setValidations: (value: string[]) => void
  ) => {
    setValidations(["Validating..."]);
    const token = Math.random();
    lastPrevalidate = token;
    const validations: string[] = [];
    await Promise.all(
      prefixes.map(async (prefix) => {
        const newValidations = await runValidateLambda(prefix, files);
        console.log({ lastPrevalidate, token });
        if (newValidations.length > 0) {
          validations.push(
            ...newValidations.map((validation) => `${prefix}: ${validation}`)
          );
        } else {
          validations.push(`${prefix}: Passed Validation`);
        }
        console.log(lastPrevalidate === token, validations);
        if (lastPrevalidate === token) setValidations([...validations]);
      })
    );
  },
  1000
);

async function runValidateLambda(
  prefix: string,
  files: string[]
): Promise<string[]> {
  try {
    const result = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: process.env.VALIDATE_LAMBDA,
        Payload: new TextEncoder().encode(JSON.stringify({ prefix, files })),
      })
    );
    const payload = JSON.parse(new TextDecoder("utf-8").decode(result.Payload));
    if (payload.errorMessage) return [payload.errorMessage];
    return payload;
  } catch (e) {
    console.log('Error running validator (856):', e);
    return ["Error running validator"];
  }
}

const runPostvalidate = debounce(
  async (filesetId: string, setOutput: (output: string) => void) => {
    const output = await runPostvalidateLambda(filesetId);
    setOutput(output);
  },
  1000
);

async function runPostvalidateLambda(filesetId: string): Promise<string> {
  try {
    const result = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: process.env.POSTVALIDATE_LAMBDA,
        Payload: new TextEncoder().encode(JSON.stringify({ filesetId })),
      })
    );
    const payload = JSON.parse(new TextDecoder("utf-8").decode(result.Payload));
    if (payload.errorMessage) return payload.errorMessage;
    return payload;
  } catch (e) {
    console.error("error invoking postvalidate lambda: (" + process.env.POSTVALIDATE_LAMBDA + ")", e);
    return "error invoking postvalidate lambda: (" + process.env.POSTVALIDATE_LAMBDA + ")";
  }
}

async function getCompleteCheck() {
  return {
    modified: (await s3Client.send(new HeadObjectCommand({
      Bucket: process.env.ARTIFACTS_BUCKET,
      Key: "complete-check.html",
    }))).LastModified!,
    url: await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: process.env.ARTIFACTS_BUCKET,
        Key: "complete-check.html",
      })
    )
  }
}

function CompleteCheck() {
  const completeCheck = useAsync(getCompleteCheck);

  if (completeCheck.loading) {
    return (<p>Loading...</p>);
  } else if (completeCheck.error) {
    return (<p>Error: {completeCheck.error.message}</p>);
  } else {
    return (
      <p>
        <a href={completeCheck.value.url} target="_blank" rel="noopener noreferrer">Complete Check</a>
        {" "}
          ({completeCheck.value.modified.toLocaleString()})
      </p>
    );
  }
}
