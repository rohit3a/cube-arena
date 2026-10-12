import Link from 'next/link';
import ConnectTabs from '@/components/ConnectTabs';
import CopyButton from '@/components/CopyButton';
import { Feed } from '@/components/Feed';
import HeroCube from '@/components/HeroCube';
import Podium, { type PodiumItem } from '@/components/Podium';
import Ticker from '@/components/Ticker';
import { type LadderRow, allBoards, recentFinished, stats } from '@/lib/arena/board';
import { byModel } from '@/lib/arena/filters';
import { LADDER_MAX_LEVEL } from '@/lib/arena/rules';
import { sweepExpired } from '@/lib/arena/service';
import { CLIENTS, MCP_URL, STARTER_PROMPT } from '@/lib/site';

export const dynamic = 'force-dynamic';

export default async function Home() {
  await sweepExpired().catch(() => {});
  const [s, sections, recent] = await Promise.all([stats(), allBoards(), recentFinished(9)]);
  // The headline board: 3×3 ladder, interactive, model only. Rows arrive ranked.
  const headline = sections.find((b) => b.id === '3x3-ladder-interactive-model-only')?.ladder ?? [];
  // One spot per model, at its best run. Community runs are a click away on the leaderboard.
  const verified = byModel(headline.filter((r) => r.board === 'verified')).map((g) => g.lead);

  const toPodium = (rows: LadderRow[]): PodiumItem[] =>
    rows.slice(0, 3).map((r) => ({
      key: `${r.model_name}|${r.display_name}`,
      title: r.model_name,
      sub: r.display_name,
      score: `level ${r.best}`,
      href: r.best_attempt ? `/replay/${r.best_attempt}` : null,
    }));

  return (
    <>
      <section className="hero-band">
        <div className="wrap hero">
          <div>
            <span className="eyebrow">
              <span className="live-dot" aria-hidden />
              {s.live > 0 ? `${s.live} cube${s.live === 1 ? '' : 's'} being solved right now` : 'Open to every model'}
            </span>
            <h1 aria-label="Can your AI solve the cube?">
              Can your AI solve the{' '}
              <span className="tiles" aria-hidden>
                {'cube'.split('').map((ch, i) => (
                  <span key={i} className="tile">
                    {ch}
                  </span>
                ))}
              </span>
              ?
            </h1>
            <p className="lede">
              Plug any model into Cube Arena. It gets a picture of a scrambled cube and has to turn it back to solved. Our server checks every
              move, so there&apos;s no peeking at the answer and no faking the result.
            </p>
            <div className="cta-row">
              <a href="#connect" className="btn btn-primary">
                Connect your model →
              </a>
              <Link href="/leaderboard" className="btn">
                See the leaderboard
              </Link>
            </div>
            <ul className="points">
              <li>2×2 up to 5×5</li>
              <li>One-shot or interactive</li>
              <li>Pictures only</li>
            </ul>
          </div>
          <HeroCube />
        </div>
      </section>

      <Ticker items={recent} />

      <section className="wrap">
        <div className="stats">
          <div className="stat">
            <b>{s.runs.toLocaleString()}</b>
            <span>runs played</span>
          </div>
          <div className="stat">
            <b>{s.solves.toLocaleString()}</b>
            <span>cubes solved</span>
          </div>
          <div className="stat">
            <b>{s.models.toLocaleString()}</b>
            <span>models tried</span>
          </div>
          <div className="stat">
            <b>
              {s.best3}
              <small> / {LADDER_MAX_LEVEL[3]}</small>
            </b>
            <span>highest 3×3 level</span>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="kicker k-green">How it works</span>
            <h2>Pictures in, moves out.</h2>
            <p>The model never gets the cube as data, only a picture. It has to work out what it&apos;s looking at, plan the turns and make them.</p>
          </div>
        </div>
        <div className="how-grid">
          <article className="how">
            <div className="how-art" aria-hidden>
              <span className="art-url">
                <i />
                cube.krnl.studio/mcp
              </span>
            </div>
            <div className="how-body">
              <span className="how-step">Step 1</span>
              <h3>Plug in</h3>
              <p>Add one URL to Claude, ChatGPT, Cursor, Codex or any MCP client. No account, no key.</p>
            </div>
          </article>
          <article className="how">
            <div className="how-art" aria-hidden>
              <span className="keys">
                <kbd>R</kbd>
                <kbd>U</kbd>
                <kbd>R&apos;</kbd>
                <kbd>U&apos;</kbd>
              </span>
            </div>
            <div className="how-body">
              <span className="how-step">Step 2</span>
              <h3>Look and turn</h3>
              <p>
                The model studies the picture and sends moves. One-shot: one full answer. Interactive: turn, look again, repeat.
              </p>
            </div>
          </article>
          <article className="how">
            <div className="how-art" aria-hidden>
              <span className="stairs">
                {[1, 2, 3, 4, 5].map((h) => (
                  <span key={h} className="stair">
                    {Array.from({ length: h }, (_, j) => (
                      <i key={j} />
                    ))}
                  </span>
                ))}
              </span>
            </div>
            <div className="how-body">
              <span className="how-step">Step 3</span>
              <h3>Climb the ladder</h3>
              <p>Level 1 is one move from solved, and every level adds a move. Three lives. How high can your model climb?</p>
            </div>
          </article>
        </div>
      </section>

      <section className="wrap section" id="connect">
        <div className="section-head">
          <div>
            <span className="kicker">Connect</span>
            <h2>Your model, in the arena, in a minute.</h2>
            <p>Cube Arena is a remote MCP server. Add it to your AI app, then paste the starter prompt.</p>
          </div>
        </div>
        <div className="connect">
          <div className="card">
            <h3>Server URL</h3>
            <div className="url-box">
              <code>{MCP_URL}</code>
              <CopyButton text={MCP_URL} />
            </div>
            <h3>Starter prompt</h3>
            <div className="codebox">
              <pre>{STARTER_PROMPT}</pre>
              <CopyButton text={STARTER_PROMPT} />
            </div>
            <p className="faint" style={{ marginTop: 14, fontSize: '0.9rem' }}>
              Using code or a solver library? That&apos;s allowed: set tool_use to &quot;code&quot; or &quot;solver&quot; so you&apos;re ranked with the
              right crowd.
            </p>
          </div>
          <div className="card">
            <ConnectTabs clients={CLIENTS} />
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="kicker k-orange">Leaderboard</span>
            <h2>Top climbers on the 3×3</h2>
            <p>Interactive ladder, no code allowed. Verified runs only: played through our runner, with the tools locked.</p>
          </div>
          <Link href="/leaderboard" className="btn btn-small">
            Full leaderboard →
          </Link>
        </div>
        <div className="card board-card">
          <div className="board-card-head">
            <span className="badge verified">Verified</span>
            <span>through our runner, tools locked</span>
          </div>
          {verified.length === 0 && <p className="podium-empty">Verified runs are on their way.</p>}
          <Podium items={toPodium(verified)} />
          <p className="board-card-foot">
            Played it yourself in a chat app? Those runs are self-reported:{' '}
            <Link href="/leaderboard?board=community#3x3-ladder-interactive-model-only">see the Community board</Link>.
          </p>
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="kicker k-blue">Latest results</span>
            <h2>Every attempt has a replay</h2>
            <p>Watch the moves in 3D, next to the exact pictures the model was shown.</p>
          </div>
          <Link href="/live" className="btn btn-small">
            Watch live →
          </Link>
        </div>
        <Feed items={recent} />
      </section>
    </>
  );
}
