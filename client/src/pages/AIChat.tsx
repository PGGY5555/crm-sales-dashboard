import { trpc } from "@/lib/trpc";
import { AIChatBox, Message } from "@/components/AIChatBox";
import { useState } from "react";

const SUGGESTED_PROMPTS = [
  "上個月表現最好的業務員是誰？",
  "目前有多少沉睡客？如何喚醒他們？",
  "本月營收與上月相比如何？",
  "顯示所有客戶分類的回購建議",
  "哪些客戶最有可能流失？",
  "給我一份銷售績效總結報告",
];

export default function AIChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "system",
      content:
        "你是一個專業的銷售數據分析助手，幫助用戶理解銷售數據並提供可行的建議。",
    },
  ]);

  const chatMutation = trpc.ai.chat.useMutation({
    onSuccess: (response) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: response.content },
      ]);
    },
    onError: (error) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `抱歉，發生了錯誤：${error.message}。請稍後再試。`,
        },
      ]);
    },
  });

  const handleSend = (content: string) => {
    const newMessages: Message[] = [
      ...messages,
      { role: "user", content },
    ];
    setMessages(newMessages);
    chatMutation.mutate({
      messages: newMessages.filter((m) => m.role !== "system"),
    });
  };

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI 銷售洞察</h1>
        <p className="text-muted-foreground mt-1">
          用自然語言詢問銷售數據問題，獲取即時分析與建議
        </p>
      </div>

      <AIChatBox
        messages={messages}
        onSendMessage={handleSend}
        isLoading={chatMutation.isPending}
        placeholder="輸入您的問題，例如「上個月營收多少？」"
        height="calc(100vh - 14rem)"
        emptyStateMessage="向 AI 助手詢問銷售數據問題"
        suggestedPrompts={SUGGESTED_PROMPTS}
      />
    </div>
  );
}
