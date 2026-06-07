import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Shield, ShieldCheck, ShieldOff } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function AccountSettings() {
  const utils = trpc.useUtils();
  const statusQuery = trpc.auth.get2FAStatus.useQuery();
  const [setupData, setSetupData] = useState<{
    qrCodeDataUrl: string;
    manualEntryKey: string;
  } | null>(null);
  const [enableCode, setEnableCode] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const generateMutation = trpc.auth.generate2FA.useMutation({
    onSuccess: (data) => {
      setSetupData(data);
      setEnableCode("");
      toast.success("已產生 QR Code，請使用 Authenticator 掃描");
    },
    onError: (error) => toast.error(error.message),
  });

  const enableMutation = trpc.auth.verifyAndEnable2FA.useMutation({
    onSuccess: async () => {
      toast.success("雙因子驗證已啟用");
      setSetupData(null);
      setEnableCode("");
      await utils.auth.get2FAStatus.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const disableMutation = trpc.auth.disable2FA.useMutation({
    onSuccess: async () => {
      toast.success("雙因子驗證已停用");
      setDisableCode("");
      setSetupData(null);
      await utils.auth.get2FAStatus.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const enabled = statusQuery.data?.enabled ?? false;
  const pendingSetup = statusQuery.data?.pendingSetup ?? false;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">帳號設定</h1>
        <p className="text-sm text-muted-foreground mt-1">管理登入安全與雙因子驗證</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                雙因子驗證 (2FA)
              </CardTitle>
              <CardDescription>
                使用 Google Authenticator 等 App 產生一次性驗證碼，提升帳號安全性。
              </CardDescription>
            </div>
            {enabled ? (
              <Badge variant="default" className="shrink-0">
                <ShieldCheck className="mr-1 h-3 w-3" />
                已啟用
              </Badge>
            ) : (
              <Badge variant="secondary" className="shrink-0">
                未啟用
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {!enabled && (
            <div className="space-y-4">
              {!setupData && (
                <Button
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      產生中…
                    </>
                  ) : pendingSetup ? (
                    "重新產生 QR Code"
                  ) : (
                    "開始設定 2FA"
                  )}
                </Button>
              )}

              {setupData && (
                <div className="space-y-4 rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    1. 使用 Authenticator App 掃描下方 QR Code（或手動輸入金鑰）
                  </p>
                  <div className="flex justify-center">
                    <img
                      src={setupData.qrCodeDataUrl}
                      alt="2FA QR Code"
                      className="h-48 w-48 rounded-md border bg-white p-2"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">手動輸入金鑰</Label>
                    <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
                      {setupData.manualEntryKey}
                    </code>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    2. 輸入 App 顯示的 6 位數驗證碼以完成綁定
                  </p>
                  <div className="flex gap-2">
                    <Input
                      inputMode="numeric"
                      placeholder="000000"
                      maxLength={6}
                      value={enableCode}
                      onChange={(event) =>
                        setEnableCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                    />
                    <Button
                      onClick={() => enableMutation.mutate({ token: enableCode })}
                      disabled={enableMutation.isPending || enableCode.length !== 6}
                    >
                      {enableMutation.isPending ? "驗證中…" : "確認啟用"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {enabled && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <ShieldOff className="mr-2 h-4 w-4" />
                  停用 2FA
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>停用雙因子驗證？</AlertDialogTitle>
                  <AlertDialogDescription>
                    為確認身分，請輸入 Authenticator 目前顯示的 6 位數驗證碼。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  value={disableCode}
                  onChange={(event) =>
                    setDisableCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={disableCode.length !== 6 || disableMutation.isPending}
                    onClick={(event) => {
                      event.preventDefault();
                      disableMutation.mutate({ token: disableCode });
                    }}
                  >
                    {disableMutation.isPending ? "處理中…" : "確認停用"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
