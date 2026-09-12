"use client";

import { useState } from "react";
import { AIMessage } from "@langchain/core/messages";
import {
  useMessages,
  type AnyStream,
  type SubgraphDiscoverySnapshot,
} from "@langchain/react";
import { Markdown } from "./Markdown";

const statusBadge: Record<string, string> = {
  pending: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  running: "bg-blue-500 text-white animate-pulse",
  complete: "bg-green-500 text-white",
  error: "bg-red-500 text-white",
};

export function NodeCard({
  node,
  stream,
}: {
  node: SubgraphDiscoverySnapshot;
  stream: AnyStream;
}) {
  const [userToggled, setUserToggled] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const messages = useMessages(stream, node);
  const lastAIMessage = messages.find(AIMessage.isInstance);
  const streamingContent = lastAIMessage?.text ?? "";

  // Derive open state from node status unless the user has manually toggled.
  const autoOpen = node.status === "running";
  const open = userToggled ? manualOpen : autoOpen;

  const toggle = () => {
    setUserToggled(true);
    setManualOpen((v) => !v);
  };

  return (
    <div className="rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between p-4"
      >
        <div className="flex items-center gap-3">
          <h3 className="font-semibold capitalize">{node.nodeName}</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${statusBadge[node.status] ?? statusBadge.pending}`}
          >
            {node.status}
          </span>
        </div>
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
      </button>

      {open && (
        <div className="border-t px-4 py-3 dark:border-gray-700">
          {streamingContent.trim() ? (
            <Markdown>{streamingContent}</Markdown>
          ) : (
            <p className="italic text-gray-500 dark:text-gray-400">Processing…</p>
          )}
        </div>
      )}
    </div>
  );
}