"use client";

import type { SubgraphDiscoverySnapshot } from "@langchain/react";

const statusColors: Record<string, string> = {
  pending: "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300",
  running: "bg-blue-500 text-white animate-pulse",
  complete: "bg-green-500 text-white",
  error: "bg-red-500 text-white",
};

export function PipelineProgress({
  nodes,
  isLoading,
}: {
  nodes: SubgraphDiscoverySnapshot[];
  isLoading: boolean;
}) {
  const firstIncompleteIdx = nodes.findIndex((n) => n.status !== "complete");

  return (
    <div className="flex flex-wrap items-center gap-1">
      {nodes.map((node, i) => {
        const isRunning =
          isLoading && node.status !== "complete" && firstIncompleteIdx === i;
        const status = isRunning ? "running" : node.status;

        return (
          <div key={node.id} className="flex items-center">
            <div
              className={`rounded-full px-3 py-1 text-xs font-medium ${statusColors[status] ?? statusColors.pending}`}
            >
              {node.nodeName}
            </div>
            {i < nodes.length - 1 && (
              <div
                className={`mx-1 h-0.5 w-6 ${status === "complete" ? "bg-green-500" : "bg-gray-200 dark:bg-gray-700"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}