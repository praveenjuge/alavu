import { api } from "@convex/_generated/api";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { Button } from "react-aria-components";
import { ChevronLeft, ChevronRight } from "vadivam-react";
import { EntryRow, useEntryEditor } from "../components/entry";
import { tints } from "../components/icons";
import { Badge, BudgetBar, Group, leftLabel, PageHeader, Row } from "../components/ui";
import { useApp } from "../data";
import { formatCompact, formatMoney } from "../lib/money";
import {
  dayTitle,
  lastDay,
  nextPeriod,
  type Period,
  periodContaining,
  periodDays,
  periodTitle,
  previousPeriod,
  today,
} from "../lib/period";
import { budgetStatus, type Summary, summarize } from "../lib/summary";

/** The current budget period of the selected space, with arrows to step through months. */
export function usePeriod() {
  const { space } = useApp();
  const [anchor, setAnchor] = useState<string | null>(null);
  const period = periodContaining(anchor ?? today(), space.monthStartDay);
  const current = periodContaining(today(), space.monthStartDay);
  return {
    period,
    isCurrent: period.start === current.start,
    previous: () => setAnchor(previousPeriod(period).start),
    next: () => setAnchor(nextPeriod(period).start),
  };
}

export function PeriodStepper({ stepper }: { stepper: ReturnType<typeof usePeriod> }) {
  return (
    <div className="stepper">
      <Button className="button plain icon" aria-label="Previous period" onPress={stepper.previous}>
        <ChevronLeft size={20} aria-hidden />
      </Button>
      <strong>{periodTitle(stepper.period)}</strong>
      <Button
        className="button plain icon"
        aria-label="Next period"
        isDisabled={stepper.isCurrent}
        onPress={stepper.next}
      >
        <ChevronRight size={20} aria-hidden />
      </Button>
    </div>
  );
}

export function usePeriodEntries(period: Period) {
  const { space } = useApp();
  return useQuery(api.reads.entriesInRange, {
    spaceUid: space.uid,
    from: period.start,
    to: lastDay(period),
  });
}

export function Overview() {
  const { space, budgets, categoryByUid, recurringRules } = useApp();
  const { open } = useEntryEditor();
  const stepper = usePeriod();
  const entries = usePeriodEntries(stepper.period);
  const summary = useMemo(
    () => (entries ? summarize(entries, stepper.period) : null),
    [entries, stepper.period],
  );
  const recent = usePaginatedQuery(
    api.reads.entriesPage,
    { spaceUid: space.uid },
    { initialNumItems: 5 },
  );
  const overall = budgets.find((b) => b.categoryUid === undefined);
  const upcoming = recurringRules
    .filter((r) => r.pausedAt === undefined && r.nextDueOn !== "9999-12-31")
    .slice(0, 3);
  const c = space.currency;

  return (
    <>
      <PageHeader title="Overview" />
      <Group>
        <PeriodStepper stepper={stepper} />
        <div className="card-pad">
          <div className="muted" style={{ fontSize: 15 }}>
            Spent
          </div>
          <div className="hero-amount num">{summary ? formatMoney(summary.expense, c) : "…"}</div>
          {summary && overall && (
            <>
              <BudgetBar status={budgetStatus(summary, overall)} />
              <div className="muted num" style={{ fontSize: 15, marginTop: 6 }}>
                {leftLabel(budgetStatus(summary, overall), c)}
              </div>
            </>
          )}
        </div>
        {summary && (
          <>
            <Row
              title="Income"
              trailing={<span className="num">{formatMoney(summary.income, c)}</span>}
            />
            <Row
              title="Transfers"
              trailing={
                <span className="num">
                  {formatMoney(summary.transferIn - summary.transferOut, c, { sign: true })}
                </span>
              }
            />
            <Row
              title="Net"
              trailing={
                <span className={`num ${summary.net > 0n ? "amount-in" : ""}`}>
                  {formatMoney(summary.net, c, { sign: true })}
                </span>
              }
            />
          </>
        )}
      </Group>

      {summary && summary.expense > 0n && (
        <>
          <Group header="Daily Spending" padded>
            <DailyChart summary={summary} period={stepper.period} currency={c} />
          </Group>
          <Group header="Top Categories">
            {summary.byCategory.slice(0, 5).map(({ categoryUid, amount }) => {
              const category = categoryUid ? categoryByUid.get(categoryUid) : undefined;
              const share = Number((amount * 1000n) / summary.expense) / 10;
              return (
                <Row
                  key={categoryUid ?? "none"}
                  icon={<Badge symbol={category?.symbol ?? "tag"} />}
                  title={category?.name ?? "Uncategorized"}
                  subtitle={`${share.toFixed(0)}% of spending`}
                  trailing={<span className="num">{formatMoney(amount, c)}</span>}
                />
              );
            })}
          </Group>
        </>
      )}

      {upcoming.length > 0 && (
        <Group header="Upcoming">
          {upcoming.map((rule) => (
            <Row
              key={rule.uid}
              icon={
                <Badge
                  symbol={categoryByUid.get(rule.categoryUid ?? "")?.symbol ?? "tag"}
                  tint={rule.kind === "income" ? tints.green : undefined}
                />
              }
              title={rule.title}
              subtitle={dayTitle(rule.nextDueOn)}
              trailing={<span className="num">{formatMoney(rule.amountMinor, rule.currency)}</span>}
            />
          ))}
        </Group>
      )}

      <Group header="Recent">
        {recent.results.length === 0 ? (
          <p className="empty">Add what you spend or earn and it shows up here.</p>
        ) : (
          recent.results.map((entry) => (
            <EntryRow key={entry._id} entry={entry} onPress={() => open(entry)} />
          ))
        )}
      </Group>
    </>
  );
}

function DailyChart({
  summary,
  period,
  currency,
}: {
  summary: Summary;
  period: Period;
  currency: string;
}) {
  const days = periodDays(period);
  const values = days.map((d) => summary.daily.get(d) ?? 0n);
  const max = values.reduce((m, v) => (v > m ? v : m), 0n);
  // Drawn at a fixed aspect ratio so labels keep their size at any width.
  const width = 640;
  const height = 200;
  const axisW = 56;
  const chartW = width - axisW;
  const chartH = height - 22;
  const barW = chartW / days.length;
  const label = `Daily spending for ${periodTitle(period)}, highest ${formatMoney(max, currency)}`;
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {[0, 0.5, 1].map((f) => {
        const y = chartH - f * (chartH - 8);
        return (
          <g key={f}>
            <line className="axis" x1={0} x2={chartW} y1={y + 0.5} y2={y + 0.5} />
            <text x={width} y={y + 4} textAnchor="end">
              {formatCompact(BigInt(Math.round(Number(max) * f)), currency)}
            </text>
          </g>
        );
      })}
      {values.map((v, i) => {
        const h = max > 0n ? (Number(v) / Number(max)) * (chartH - 8) : 0;
        return v > 0n ? (
          <rect
            key={days[i]}
            className="bar"
            x={i * barW + barW * 0.15}
            width={barW * 0.7}
            y={chartH - h}
            height={h}
            rx={2}
          >
            <title>{`${dayTitle(days[i])}: ${formatMoney(v, currency)}`}</title>
          </rect>
        ) : null;
      })}
      {days.map((d, i) =>
        i % 7 === 0 ? (
          <text key={d} x={i * barW + barW / 2} y={height - 4} textAnchor="middle">
            {Number(d.slice(8))}
          </text>
        ) : null,
      )}
    </svg>
  );
}
