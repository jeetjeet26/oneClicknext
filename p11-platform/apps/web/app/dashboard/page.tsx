"use client";

import { useState, useEffect, useCallback } from "react";
import { usePropertyContext } from "@/components/layout/PropertyContext";
import { MetricCard } from "@/components/charts";
import {
  Users,
  DollarSign,
  Bot,
  TrendingUp,
  MessageSquare,
  UserPlus,
  ArrowRight,
  FileText,
  RefreshCw,
  Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

type Metric = {
  value: number;
  change: number;
  period: string;
};

type NullableMetric = {
  value: number | null;
  change: number;
  period: string;
};

type ActivityItem = {
  id: string;
  type: "lead" | "message_in" | "message_out";
  title: string;
  subtitle: string;
  timestamp: string;
};

type OverviewData = {
  metrics: {
    totalLeads: Metric;
    costPerLead: NullableMetric;
    aiResponseRate: NullableMetric;
    totalSpend: Metric;
    conversions: Metric;
    documentsCount: number;
  };
  recentActivity: ActivityItem[];
  summary: {
    impressions: number;
    clicks: number;
    ctr: number;
    hasMarketingData: boolean;
  };
};

export default function DashboardPage() {
  const { currentProperty, loading: propertyLoading } = usePropertyContext();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (propertyLoading || !currentProperty?.id) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/dashboard/overview?propertyId=${currentProperty.id}`,
      );

      if (!response.ok) {
        let message = "Failed to fetch dashboard data";

        try {
          const result = await response.json();
          if (
            typeof result?.error === "string" &&
            result.error.trim().length > 0
          ) {
            message = result.error;
          }
        } catch {
          // Ignore JSON parsing errors and keep the fallback message.
        }

        throw new Error(message);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [currentProperty?.id, propertyLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hasMarketingData = data?.summary.hasMarketingData ?? false;

  const getActivityIcon = (type: ActivityItem["type"]) => {
    switch (type) {
      case "lead":
        return <UserPlus size={14} className="text-emerald-500" />;
      case "message_in":
        return <MessageSquare size={14} className="text-blue-500" />;
      case "message_out":
        return <Bot size={14} className="text-primary" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="console-kicker">Your workspace</p>
          <h1 className="text-[29px] font-semibold text-foreground">
            Property overview
          </h1>
          <p className="text-muted-foreground mt-1">
            Your last 30 days at {currentProperty?.name || "your property"}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg hover:bg-muted transition-colors text-sm font-medium text-card-foreground disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="console-error">
          {error}{" "}
          <button onClick={fetchData} className="underline ml-2">
            Try again
          </button>
        </div>
      )}
      {/* Key Metrics */}
      <div className="console-overview-metrics grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="New inquiries"
          value={data?.metrics.totalLeads.value ?? "—"}
          change={data?.metrics.totalLeads.change}
          changeLabel="vs previous 30 days"
          icon={<Users size={20} />}
          loading={loading}
        />
        <MetricCard
          title="Cost per inquiry"
          value={
            typeof data?.metrics.costPerLead.value === "number"
              ? data.metrics.costPerLead.value.toFixed(2)
              : "—"
          }
          prefix={
            typeof data?.metrics.costPerLead.value === "number" ? "$" : ""
          }
          change={
            typeof data?.metrics.costPerLead.value === "number"
              ? -data.metrics.costPerLead.change
              : undefined
          }
          changeLabel="vs previous 30 days"
          subtitle={
            hasMarketingData
              ? "No leads this period"
              : data ? "No marketing data for this period" : "Results unavailable"
          }
          icon={<DollarSign size={20} />}
          loading={loading}
        />
        <MetricCard
          title="Marketing spend"
          value={
            hasMarketingData
              ? (data?.metrics.totalSpend.value?.toFixed(0) ?? "0")
              : "—"
          }
          prefix={hasMarketingData ? "$" : ""}
          change={
            hasMarketingData ? data?.metrics.totalSpend.change : undefined
          }
          changeLabel="vs previous 30 days"
          subtitle={data ? "No marketing data for this period" : "Results unavailable"}
          icon={<TrendingUp size={20} />}
          loading={loading}
        />
        <MetricCard
          title="Assistant response rate"
          value={
            typeof data?.metrics.aiResponseRate.value === "number"
              ? data.metrics.aiResponseRate.value.toFixed(1)
              : "—"
          }
          suffix={
            typeof data?.metrics.aiResponseRate.value === "number" ? "%" : ""
          }
          change={
            typeof data?.metrics.aiResponseRate.value === "number"
              ? data.metrics.aiResponseRate.change
              : undefined
          }
          changeLabel="pts vs previous 30 days"
          subtitle={data ? "No visitor messages this period" : "Results unavailable"}
          icon={<Bot size={20} />}
          loading={loading}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent activity */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-foreground">
              Recent activity
            </h2>
            <Link
              href="/dashboard/intelligence?section=campaigns"
              className="text-sm text-primary hover:text-[#78260e] flex items-center gap-1"
            >
              Campaign performance
              <ArrowRight size={14} />
            </Link>
          </div>

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-start gap-3 animate-pulse">
                  <div className="h-8 w-8 bg-slate-200 rounded-lg"></div>
                  <div className="flex-1">
                    <div className="h-4 bg-slate-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-slate-200 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : data?.recentActivity && data.recentActivity.length > 0 ? (
            <div className="space-y-4">
              {data.recentActivity.map((activity, idx) => (
                <div
                  key={activity.id}
                  className={`flex items-start gap-3 pb-4 ${
                    idx < data.recentActivity.length - 1
                      ? "border-b border-border"
                      : ""
                  }`}
                >
                  <div
                    className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                      activity.type === "lead"
                        ? "bg-emerald-50"
                        : activity.type === "message_in"
                          ? "bg-blue-50"
                          : "bg-accent"
                    }`}
                  >
                    {getActivityIcon(activity.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {activity.title}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {activity.subtitle}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {formatDistanceToNow(new Date(activity.timestamp), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="h-12 w-12 bg-secondary rounded-xl flex items-center justify-center mx-auto mb-3">
                <Zap size={24} className="text-slate-400" />
              </div>
              <p className="text-muted-foreground text-sm mb-1">{data ? "No recent activity" : "Activity unavailable"}</p>
              <p className="text-slate-400 text-xs">
                {data ? "Activity will appear here as leads come in and conversations happen." : "Try refreshing to load recent activity."}
              </p>
            </div>
          )}
        </div>

        {/* Quick Stats & Actions */}
        <div className="space-y-6">
          {/* Performance Summary */}
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">
              Performance
            </h3>
            {!loading && !hasMarketingData && (
              <p className="text-xs text-slate-400 mb-4">
                Marketing results are not available for this period. Check your data connections to see impressions, clicks and click-through rate.
              </p>
            )}
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-muted-foreground">Impressions</span>
                  <span className="font-medium text-foreground">
                    {loading
                      ? "..."
                      : hasMarketingData ? (data?.summary.impressions ?? 0).toLocaleString() : "Unavailable"}
                  </span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{
                      width:
                        loading || !data?.summary.impressions ? "0%" : "100%",
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-muted-foreground">Clicks</span>
                  <span className="font-medium text-foreground">
                    {loading
                      ? "..."
                      : hasMarketingData ? (data?.summary.clicks ?? 0).toLocaleString() : "Unavailable"}
                  </span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-neutral-500 rounded-full transition-all duration-500"
                    style={{
                      width: loading
                        ? "0%"
                        : data?.summary.impressions
                          ? `${Math.min((data.summary.clicks / data.summary.impressions) * 100 * 10, 100)}%`
                          : "0%",
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-muted-foreground">Click-through rate</span>
                  <span className="font-medium text-foreground">
                    {loading
                      ? "..."
                      : hasMarketingData ? `${(data?.summary.ctr ?? 0).toFixed(2)}%` : "Unavailable"}
                  </span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-neutral-400 rounded-full transition-all duration-500"
                    style={{
                      width: loading
                        ? "0%"
                        : `${Math.min((data?.summary.ctr || 0) * 10, 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Property knowledge Status */}
          <div className="bg-secondary rounded-xl border border-border p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 bg-card rounded-lg flex items-center justify-center shadow-sm">
                <FileText size={20} className="text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">
                  Community knowledge
                </h3>
                <p className="text-xs text-muted-foreground">
                  {loading
                    ? "..."
                    : data ? `${data.metrics.documentsCount ?? 0} document sections` : "Knowledge status unavailable"}
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/community?section=knowledge"
              className="block w-full py-2.5 bg-card text-center text-sm font-medium text-primary rounded-lg border border-[#efd8cd] hover:bg-[#fff5f0] transition-colors"
            >
              Manage knowledge
            </Link>
          </div>

          {/* Quick actions */}
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">
              Quick actions
            </h3>
            <div className="space-y-2">
              <Link
                href="/dashboard/intelligence?section=campaigns"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors group"
              >
                <div className="h-9 w-9 bg-muted rounded-lg flex items-center justify-center group-hover:bg-accent transition-colors">
                  <TrendingUp size={18} className="text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    Campaign performance
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Marketing results and saved reports
                  </p>
                </div>
                <ArrowRight size={16} className="text-slate-400" />
              </Link>
              <Link
                href="/dashboard/luma"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors group"
              >
                <div className="h-9 w-9 bg-muted rounded-lg flex items-center justify-center group-hover:bg-accent transition-colors">
                  <MessageSquare size={18} className="text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    Open conversations
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Review inquiries and test the leasing assistant
                  </p>
                </div>
                <ArrowRight size={16} className="text-slate-400" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
