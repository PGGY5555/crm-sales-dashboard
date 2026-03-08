import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Mail, Phone, Calendar, Tag, CreditCard, ShoppingCart, Package, User, MessageSquare, Shield, Hash, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";

export default function CustomerDetail() {
  const [matched1, params1] = useRoute("/customer/:id");
  const [matched2, params2] = useRoute("/customer-detail/:id");
  const params = matched1 ? params1 : params2;
  const customerId = Number(params?.id);

  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.customerMgmt.detail.useQuery(
    { id: customerId },
    { enabled: !!customerId && !isNaN(customerId) }
  );

  const updateMutation = trpc.customerMgmt.update.useMutation({
    onSuccess: () => {
      toast.success("客戶資料已更新");
      utils.customerMgmt.detail.invalidate({ id: customerId });
      setEditing(false);
    },
    onError: (err) => {
      toast.error("更新失敗：" + err.message);
    },
  });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data?.customer) {
      const c = data.customer;
      setForm({
        name: c.name || "",
        email: c.email || "",
        phone: c.phone || "",
        birthday: c.birthday || "",
        tags: c.tags || "",
        memberLevel: c.memberLevel || "",
        credits: String(c.credits || "0"),
        recipientName: c.recipientName || "",
        recipientPhone: c.recipientPhone || "",
        recipientEmail: c.recipientEmail || "",
        notes: c.notes || "",
        note1: c.note1 || "",
        note2: c.note2 || "",
        custom1: c.custom1 || "",
        custom2: c.custom2 || "",
        custom3: c.custom3 || "",
        blacklisted: c.blacklisted || "否",
        lineUid: c.lineUid || "",
      });
    }
  }, [data?.customer]);

  const handleSave = () => {
    updateMutation.mutate({
      id: customerId,
      name: form.name || null,
      email: form.email || null,
      phone: form.phone || null,
      birthday: form.birthday || null,
      tags: form.tags || null,
      memberLevel: form.memberLevel || null,
      credits: form.credits || "0",
      recipientName: form.recipientName || null,
      recipientPhone: form.recipientPhone || null,
      recipientEmail: form.recipientEmail || null,
      notes: form.notes || null,
      note1: form.note1 || null,
      note2: form.note2 || null,
      custom1: form.custom1 || null,
      custom2: form.custom2 || null,
      custom3: form.custom3 || null,
      blacklisted: form.blacklisted || "否",
      lineUid: form.lineUid || null,
    });
  };

  const handleCancel = () => {
    if (data?.customer) {
      const c = data.customer;
      setForm({
        name: c.name || "",
        email: c.email || "",
        phone: c.phone || "",
        birthday: c.birthday || "",
        tags: c.tags || "",
        memberLevel: c.memberLevel || "",
        credits: String(c.credits || "0"),
        recipientName: c.recipientName || "",
        recipientPhone: c.recipientPhone || "",
        recipientEmail: c.recipientEmail || "",
        notes: c.notes || "",
        note1: c.note1 || "",
        note2: c.note2 || "",
        custom1: c.custom1 || "",
        custom2: c.custom2 || "",
        custom3: c.custom3 || "",
        blacklisted: c.blacklisted || "否",
        lineUid: c.lineUid || "",
      });
    }
    setEditing(false);
  };

  const updateField = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/customer-management">
            <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />返回客戶列表</Button>
          </Link>
        </div>
        <div className="flex items-center justify-center py-20 text-muted-foreground">載入中...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/customer-management">
            <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />返回客戶列表</Button>
          </Link>
        </div>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          {error?.message || "找不到該客戶"}
        </div>
      </div>
    );
  }

  const { customer: c, orders } = data;

  const lifecycleBadgeColor = (lc: string) => {
    const colors: Record<string, string> = {
      N: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
      A: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      S: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
      L: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
      D: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
      O: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    };
    return colors[lc] || "bg-gray-100 text-gray-800";
  };

  const lifecycleLabel = (lc: string) => {
    const labels: Record<string, string> = {
      N: "新鮮客", A: "活躍客", S: "沉睡客", L: "流失客", D: "封存客", O: "機會客",
    };
    return labels[lc] || lc;
  };

  // Editable field helper
  const EditableField = ({ label, icon: Icon, fieldKey, type = "text" }: { label: string; icon: any; fieldKey: string; type?: string }) => (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      {editing ? (
        <div className="flex-1">
          <label className="text-xs text-muted-foreground">{label}</label>
          <Input
            value={form[fieldKey] || ""}
            onChange={e => updateField(fieldKey, e.target.value)}
            className="h-8 text-sm mt-0.5"
            placeholder={label}
          />
        </div>
      ) : (
        <span>{label}：{form[fieldKey] || "-"}</span>
      )}
    </div>
  );

  // Editable textarea helper
  const EditableTextarea = ({ label, icon: Icon, fieldKey }: { label: string; icon: any; fieldKey: string }) => (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
        <Icon className="w-4 h-4" /> {label}
      </h4>
      {editing ? (
        <Textarea
          value={form[fieldKey] || ""}
          onChange={e => updateField(fieldKey, e.target.value)}
          className="text-sm min-h-[60px]"
          placeholder={`輸入${label}...`}
        />
      ) : (
        <p className="text-sm bg-muted/50 rounded-md p-3 whitespace-pre-wrap">{form[fieldKey] || "-"}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/customer-management">
            <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />返回客戶列表</Button>
          </Link>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button variant="outline" size="sm" onClick={handleCancel} disabled={updateMutation.isPending}>
                <X className="w-4 h-4 mr-1" />取消
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                <Save className="w-4 h-4 mr-1" />{updateMutation.isPending ? "儲存中..." : "儲存"}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="w-4 h-4 mr-1" />編輯
            </Button>
          )}
        </div>
      </div>

      {/* Customer Info Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Basic Info */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="w-6 h-6 text-primary" />
                </div>
                <div>
                  {editing ? (
                    <Input
                      value={form.name || ""}
                      onChange={e => updateField("name", e.target.value)}
                      className="text-xl font-semibold h-9"
                      placeholder="顧客姓名"
                    />
                  ) : (
                    <CardTitle className="text-xl">{c.name || "未命名客戶"}</CardTitle>
                  )}
                  <CardDescription className="flex items-center gap-2 mt-1">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${lifecycleBadgeColor(c.lifecycle || "O")}`}>
                      {c.lifecycle || "O"} {lifecycleLabel(c.lifecycle || "O")}
                    </span>
                    {editing ? (
                      <Input
                        value={form.memberLevel || ""}
                        onChange={e => updateField("memberLevel", e.target.value)}
                        className="h-6 text-xs w-24"
                        placeholder="會員等級"
                      />
                    ) : (
                      c.memberLevel && <Badge variant="outline">{c.memberLevel}</Badge>
                    )}
                    {editing ? (
                      <select
                        value={form.blacklisted || "否"}
                        onChange={e => updateField("blacklisted", e.target.value)}
                        className="h-6 text-xs border rounded px-1"
                      >
                        <option value="否">非黑名單</option>
                        <option value="是">黑名單</option>
                      </select>
                    ) : (
                      c.blacklisted === "是" && <Badge variant="destructive">黑名單</Badge>
                    )}
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground">顧客資訊</h4>
                <div className="space-y-2">
                  <EditableField label="電子信箱" icon={Mail} fieldKey="email" />
                  <EditableField label="手機" icon={Phone} fieldKey="phone" />
                  <EditableField label="生日" icon={Calendar} fieldKey="birthday" />
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span>註冊：{c.registeredAt ? new Date(c.registeredAt).toLocaleDateString("zh-TW") : "-"}</span>
                  </div>
                  <EditableField label="LINE UID" icon={Hash} fieldKey="lineUid" />
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground">收件人資訊</h4>
                <div className="space-y-2">
                  <EditableField label="收件人姓名" icon={User} fieldKey="recipientName" />
                  <EditableField label="收件人手機" icon={Phone} fieldKey="recipientPhone" />
                  <EditableField label="收件人信箱" icon={Mail} fieldKey="recipientEmail" />
                </div>
              </div>
            </div>

            {/* Tags */}
            <Separator />
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <Tag className="w-4 h-4" /> 會員標籤
              </h4>
              {editing ? (
                <Input
                  value={form.tags || ""}
                  onChange={e => updateField("tags", e.target.value)}
                  className="text-sm"
                  placeholder="多個標籤請用逗號分隔"
                />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {c.tags ? c.tags.split(",").map((tag, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{tag.trim()}</Badge>
                  )) : <span className="text-sm text-muted-foreground">-</span>}
                </div>
              )}
            </div>

            {/* Notes section */}
            <Separator />
            <EditableTextarea label="顧客備註" icon={MessageSquare} fieldKey="notes" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <EditableTextarea label="備註 1" icon={MessageSquare} fieldKey="note1" />
              <EditableTextarea label="備註 2" icon={MessageSquare} fieldKey="note2" />
            </div>

            {/* Custom fields */}
            <Separator />
            <h4 className="text-sm font-semibold text-muted-foreground">自訂欄位</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">自訂 1</label>
                {editing ? (
                  <Input
                    value={form.custom1 || ""}
                    onChange={e => updateField("custom1", e.target.value)}
                    className="text-sm h-8"
                    placeholder="自訂 1"
                  />
                ) : (
                  <p className="text-sm bg-muted/50 rounded-md p-2">{form.custom1 || "-"}</p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">自訂 2</label>
                {editing ? (
                  <Input
                    value={form.custom2 || ""}
                    onChange={e => updateField("custom2", e.target.value)}
                    className="text-sm h-8"
                    placeholder="自訂 2"
                  />
                ) : (
                  <p className="text-sm bg-muted/50 rounded-md p-2">{form.custom2 || "-"}</p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">自訂 3</label>
                {editing ? (
                  <Input
                    value={form.custom3 || ""}
                    onChange={e => updateField("custom3", e.target.value)}
                    className="text-sm h-8"
                    placeholder="自訂 3"
                  />
                ) : (
                  <p className="text-sm bg-muted/50 rounded-md p-2">{form.custom3 || "-"}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">消費統計</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <CreditCard className="w-4 h-4" /> 購物金餘額
                </span>
                {editing ? (
                  <Input
                    value={form.credits || "0"}
                    onChange={e => updateField("credits", e.target.value)}
                    className="h-7 text-sm w-24 text-right"
                  />
                ) : (
                  <span className="font-medium">${parseFloat(String(c.credits || "0")).toLocaleString()}</span>
                )}
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4" /> 累積消費金額
                </span>
                <span className="font-bold text-lg">${parseFloat(String(c.totalSpent || "0")).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Package className="w-4 h-4" /> 累積消費次數
                </span>
                <span className="font-medium">{c.totalOrders} 次</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">最後購買日期</span>
                <span className="text-sm">{c.lastPurchaseDate ? new Date(c.lastPurchaseDate).toLocaleDateString("zh-TW") : "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">最後消費金額</span>
                <span className="text-sm">{c.lastPurchaseAmount ? `$${parseFloat(String(c.lastPurchaseAmount)).toLocaleString()}` : "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">最後出貨日期</span>
                <span className="text-sm">{c.lastShipmentAt ? new Date(c.lastShipmentAt).toLocaleDateString("zh-TW") : "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">SF出貨日</span>
                <span className="text-sm">{c.sfShippedAt ? new Date(c.sfShippedAt).toLocaleDateString("zh-TW") : "-"}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Order History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            訂單歷史 ({orders.length} 筆)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[120px]">訂單編號</TableHead>
                  <TableHead className="min-w-[100px]">訂單日期</TableHead>
                  <TableHead className="min-w-[100px]">出貨日期</TableHead>
                  <TableHead className="min-w-[80px]">訂單來源</TableHead>
                  <TableHead className="min-w-[80px]">付款方式</TableHead>
                  <TableHead className="min-w-[80px]">配送方式</TableHead>
                  <TableHead className="min-w-[80px]">出貨狀態</TableHead>
                  <TableHead className="min-w-[100px] text-right">訂單金額</TableHead>
                  <TableHead className="min-w-[200px]">商品明細</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      此客戶尚無訂單記錄
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-sm">
                        <Link href={`/order-detail/${order.id}`} className="text-primary hover:underline cursor-pointer">
                          {order.externalId || `#${order.id}`}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        {order.orderDate ? new Date(order.orderDate).toLocaleDateString("zh-TW") : "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {order.shippedAt ? new Date(order.shippedAt).toLocaleDateString("zh-TW") : "-"}
                      </TableCell>
                      <TableCell className="text-sm">{order.orderSource || "-"}</TableCell>
                      <TableCell className="text-sm">{order.paymentMethod || "-"}</TableCell>
                      <TableCell className="text-sm">{order.shippingMethod || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={order.shippedAt ? "default" : "secondary"} className="text-xs">
                          {order.shippedAt ? "已出貨" : "待出貨"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium text-sm">
                        ${parseFloat(String(order.total || "0")).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {order.items && order.items.length > 0 ? (
                          <div className="space-y-0.5">
                            {order.items.map((item: any, idx: number) => (
                              <div key={idx} className="text-xs text-muted-foreground">
                                {item.productName || item.sku || "商品"} x{item.quantity}
                                {item.unitPrice ? ` ($${parseFloat(String(item.unitPrice)).toLocaleString()})` : ""}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
