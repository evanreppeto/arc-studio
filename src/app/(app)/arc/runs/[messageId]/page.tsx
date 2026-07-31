import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getArcRunInspection, type ArcRunInspection } from "@/lib/arc-chat/run-inspector";

import "./run.css";

export const metadata = { title: "Run — Arc" };

const BACK_ICON = '<path d="M15 5l-7 7 7 7"/>';

export default async function ArcRunPage({ params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  const ctx = await getCurrentWorkspaceContext();
  const result = await getArcRunInspection(decodeURIComponent(messageId), ctx.orgId);

  if (result.status === "not_found") notFound();

  return (
    <div className="arc-run">
      <div className="runband">
        <Link className="back" href="/arc">
          <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: BACK_ICON }} />
          Back to Arc
        </Link>
      </div>

      {result.status !== "live" ? (
        // Not an empty run — a run that could not be READ. Saying so is the
        // whole point of the milestone this page belongs to.
        <section className="runsec">
          <h2>This run could not be loaded</h2>
          <p className="runmuted">{result.message}</p>
        </section>
      ) : (
        <RunDetail run={result.run} />
      )}
    </div>
  );
}

function RunDetail({ run }: { run: ArcRunInspection }) {
  return (
    <>
      <header className="runhead">
        <div>
          <p className="runkicker">
            {new Date(run.createdAt).toLocaleString()} · {run.mode ?? "—"} / {run.route ?? "—"}
          </p>
          <h2>{run.request ?? "Run detail"}</h2>
        </div>
        <span className={`runpill ${run.status === "failed" ? "bad" : run.status === "complete" ? "ok" : ""}`}>
          {run.status}
        </span>
      </header>

      {/* Concerns first: the reason an operator opened this page at all. */}
      {run.concerns.length > 0 && (
        <section className="runsec runconcerns">
          <h2>What looks wrong</h2>
          <ul>
            {run.concerns.map((concern) => (
              <li key={concern}>{concern}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="runstats">
        <Stat label="Duration" value={run.durationMs === null ? "not recorded" : formatDuration(run.durationMs)} />
        <Stat label="Recalled" value={`${run.recall.length} ${run.recall.length === 1 ? "memory" : "memories"}`} bad={run.recall.length === 0} />
        <Stat label="Steps" value={`${run.steps.length}`} />
        <Stat
          label="Cost"
          value={run.cost ? `${(run.cost.cents / 100).toFixed(2)} USD` : "not recorded"}
          sub={run.cost ? `${run.cost.inputTokens.toLocaleString()} in · ${run.cost.outputTokens.toLocaleString()} out` : undefined}
        />
      </div>

      {/*
        The highest-value panel in the ticket: a run that retrieved nothing is
        meant to be obvious at a glance, so the empty case is a stated finding
        rather than a blank list.
      */}
      <section className="runsec">
        <h2>What Arc retrieved</h2>
        {run.recall.length === 0 ? (
          <p className="runmuted runbad">
            Nothing was recalled from the Brain. Any answer above came from the model, not from this workspace&rsquo;s
            memory.
          </p>
        ) : (
          <ul className="runrecall">
            {run.recall.map((item, index) => (
              <li key={item.nodeId ?? `${item.label}-${index}`}>
                <div className="runrecall-h">
                  <b>{item.summary?.trim() || item.label}</b>
                  {typeof item.confidence === "number" && (
                    <span className="runscore">{Math.round(item.confidence * 100)}%</span>
                  )}
                </div>
                <small>
                  {item.kind ?? "memory"}
                  {item.summary?.trim() ? ` · ${item.label}` : ""}
                </small>
              </li>
            ))}
          </ul>
        )}
        {run.contextScopes.length > 0 && (
          <p className="runmuted">Context scopes requested: {run.contextScopes.join(", ")}.</p>
        )}
      </section>

      <section className="runsec">
        <h2>Steps</h2>
        {run.steps.length === 0 ? (
          <p className="runmuted">No steps were recorded for this run.</p>
        ) : (
          <ol className="runsteps">
            {run.steps.map((step, index) => (
              <li key={`${step.label}-${index}`} className={step.status === "running" ? "unfinished" : ""}>
                <span className="runstep-n">{index + 1}</span>
                <div>
                  <b>{step.label}</b>
                  {step.status === "running" && <em> — never completed</em>}
                  {step.detail?.length ? <small>{step.detail.join(" · ")}</small> : null}
                </div>
                <time>{new Date(step.at).toLocaleTimeString()}</time>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="runsec">
        <h2>Tool calls</h2>
        {run.toolCalls.length === 0 ? (
          // Deliberately not "this run made no tool calls" — the runner only
          // began recording them on 2026-07-31, so absence here is usually a
          // gap in the record rather than a fact about the run.
          <p className="runmuted">
            None recorded. The runner only began writing tool calls on 2026-07-31, so older runs have none even when
            they called tools.
          </p>
        ) : (
          <ul className="runtools">
            {run.toolCalls.map((tool, index) => (
              <li key={`${tool.name}-${index}`} className={tool.status === "error" ? "bad" : ""}>
                <div className="runtool-h">
                  <b>{tool.name}</b>
                  <span className="runpill sm">{tool.status}</span>
                </div>
                {tool.output && <pre>{tool.output.slice(0, 600)}</pre>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="runsec">
        <h2>Answer</h2>
        <p className="runanswer">{run.answer.trim() || "Arc produced an empty answer."}</p>
      </section>
    </>
  );
}

function Stat({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className={`runstat${bad ? " bad" : ""}`}>
      <span className="runstat-l">{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
