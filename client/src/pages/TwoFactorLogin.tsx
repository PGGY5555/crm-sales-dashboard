import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

export default function TwoFactorLogin() {
  const [, setLocation] = useLocation();
  const [code, setCode] = useState("");
  const utils = trpc.useUtils();

  const pendingQuery = trpc.auth.getPending2FA.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const verifyMutation = trpc.auth.verifyLogin2FA.useMutation({
    onSuccess: async () => {
      toast.success("驗證成功，正在進入系統…");
      await utils.auth.me.invalidate();
      setLocation("/");
    },
    onError: (error) => {
      toast.error(error.message || "驗證碼錯誤");
    },
  });

  useEffect(() => {
    if (pendingQuery.isLoading) return;
    if (!pendingQuery.data?.pending) {
      window.location.href = getLoginUrl();
    }
  }, [pendingQuery.isLoading, pendingQuery.data?.pending]);

  if (pendingQuery.isLoading || !pendingQuery.data?.pending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      toast.error("請輸入 6 位數驗證碼");
      return;
    }
    verifyMutation.mutate({ token: code.trim() });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>雙因子驗證</CardTitle>
          <CardDescription>
            {pendingQuery.data.email
              ? `帳號 ${pendingQuery.data.email} 已啟用 2FA，請輸入 Authenticator 的 6 位數驗證碼。`
              : "請輸入 Authenticator 的 6 位數驗證碼以完成登入。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="totp-code">驗證碼</Label>
              <Input
                id="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={verifyMutation.isPending}>
              {verifyMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  驗證中…
                </>
              ) : (
                "確認登入"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                window.location.href = getLoginUrl();
              }}
            >
              返回重新登入
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
