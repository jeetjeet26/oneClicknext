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
        return <Bot size={14} className="text-[#648693]" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="console-kicker">Your workspace</p>
          <h1 className="text-[29px] font-semibold text-slate-900">
            Property overview
          </h1>
          <p className="text-slate-500 mt-1">
            Your last 30 days at {currentProperty?.name || "your property"}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700 disabled:opacity-50"
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
          value={data?.metrics.totalLeads.value ?? 0}
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
              : "No ad platform data connected"
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
          subtitle="No ad platform data connected"
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
          subtitle="No visitor messages this period"
          icon={<Bot size={20} />}
          loading={loading}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent activity */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Recent activity
            </h2>
            <Link
              href="/dashboard/bi"
              className="text-sm text-[#a53212] hover:text-[#78260e] flex items-center gap-1"
            >
              View all analytics
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
                      ? "border-b border-slate-100"
                      : ""
                  }`}
                >
                  <div
                    className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                      activity.type === "lead"
                        ? "bg-emerald-50"
                        : activity.type === "message_in"
                          ? "bg-blue-50"
                          : "bg-indigo-50"
                    }`}
                  >
                    {getActivityIcon(activity.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {activity.title}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
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
              <div className="h-12 w-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                <Zap size={24} className="text-slate-400" />
              </div>
              <p className="text-slate-500 text-sm mb-1">No recent activity</p>
              <p className="text-slate-400 text-xs">
                Activity will appear here as leads come in and conversations
                happen
              </p>
            </div>
          )}
        </div>

        {/* Quick Stats & Actions */}
        <div className="space-y-6">
          {/* Performance Summary */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              Performance
            </h3>
            {!loading && !hasMarketingData && (
              <p className="text-xs text-slate-400 mb-4">
                Connect an ad platform to see impressions, clicks, and CTR for
                this community.
              </p>
            )}
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-slate-600">Impressions</span>
                  <span className="font-medium text-slate-900">
                    {loading
                      ? "..."
                      : (data?.summary.impressions || 0).toLocaleString()}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#668a97] rounded-full transition-all duration-500"
                    style={{
                      width:
                        loading || !data?.summary.impressions ? "0%" : "100%",
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-slate-600">Clicks</span>
                  <span className="font-medium text-slate-900">
                    {loading
                      ? "..."
                      : (data?.summary.clicks || 0).toLocaleString()}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#8fa696] rounded-full transition-all duration-500"
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
                  <span className="text-slate-600">CTR</span>
                  <span className="font-medium text-slate-900">
                    {loading
                      ? "..."
                      : `${(data?.summary.ctr || 0).toFixed(2)}%`}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#bca98d] rounded-full transition-all duration-500"
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
          <div className="bg-[#eef3f3] rounded-xl border border-[#dce6e7] p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center shadow-sm">
                <FileText size={20} className="text-[#648693]" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">
                  Property knowledge
                </h3>
                <p className="text-xs text-slate-500">
                  {loading
                    ? "..."
                    : `${data?.metrics.documentsCount || 0} document sections`}
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/luma"
              className="block w-full py-2.5 bg-white text-center text-sm font-medium text-[#a53212] rounded-lg border border-[#efd8cd] hover:bg-[#fff5f0] transition-colors"
            >
              Manage Documents
            </Link>
          </div>

          {/* Quick actions */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              Quick actions
            </h3>
            <div className="space-y-2">
              <Link
                href="/dashboard/bi"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors group"
              >
                <div className="h-9 w-9 bg-[#e8eff1] rounded-lg flex items-center justify-center group-hover:bg-indigo-200 transition-colors">
                  <TrendingUp size={18} className="text-[#a53212]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    View Analytics
                  </p>
                  <p className="text-xs text-slate-500">
                    Marketing results and saved reports
                  </p>
                </div>
                <ArrowRight size={16} className="text-slate-400" />
              </Link>
              <Link
                href="/dashboard/luma"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors group"
              >
                <div className="h-9 w-9 bg-[#edf1e9] rounded-lg flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                  <MessageSquare size={18} className="text-[#6e8363]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    Open leasing assistant
                  </p>
                  <p className="text-xs text-slate-500">
                    Property knowledge and conversation testing
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
