import { trpc } from "@/lib/trpc";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Mail, Phone, Calendar, Tag, CreditCard, ShoppingCart, Package, User, MessageSquare, Shield, Hash } from "lucide-react";

export default function CustomerDetail() {
  const [, params] = useRoute("/customer/:id");
  const customerId = Number(params?.id);

  const { data, isLoading, error } = trpc.customerMgmt.detail.useQuery(
    { id: customerId },
    { enabled: !!customerId && !isNaN(customerId) }
  );

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/customer-management">
          <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />返回客戶列表</Button>
        </Link>
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
                  <CardTitle className="text-xl">{c.name || "未命名客戶"}</CardTitle>
                  <CardDescription className="flex items-center gap-2 mt-1">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${lifecycleBadgeColor(c.lifecycle || "O")}`}>
                      {c.lifecycle || "O"} {lifecycleLabel(c.lifecycle || "O")}
                    </span>
                    {c.memberLevel && <Badge variant="outline">{c.memberLevel}</Badge>}
                    {c.blacklisted === "是" && <Badge variant="destructive">黑名單</Badge>}
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
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <span>{c.email || "-"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span>{c.phone || "-"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span>生日：{c.birthday || "-"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span>註冊：{c.registeredAt ? new Date(c.registeredAt).toLocaleDateString("zh-TW") : "-"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Hash className="w-4 h-4 text-muted-foreground" />
                    <span>LINE UID：{c.lineUid || "-"}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground">收件人資訊</h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span>{c.recipientName || "-"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span>{c.recipientPhone || "-"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <span>{c.recipientEmail || "-"}</span>
                  </div>
                </div>
              </div>
            </div>

            {c.tags && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                    <Tag className="w-4 h-4" /> 會員標籤
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {c.tags.split(",").map((tag, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{tag.trim()}</Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {c.notes && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" /> 顧客備註
                  </h4>
                  <p className="text-sm bg-muted/50 rounded-md p-3">{c.notes}</p>
                </div>
              </>
            )}
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
                <span className="font-medium">${parseFloat(String(c.credits || "0")).toLocaleString()}</span>
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
                      <TableCell className="font-mono text-sm">{order.externalId || "-"}</TableCell>
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
