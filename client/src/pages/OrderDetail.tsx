import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Package, User, Truck, CreditCard, MapPin } from "lucide-react";
import { Link, useParams } from "wouter";

export default function OrderDetail() {
  const params = useParams<{ id: string }>();
  const orderId = parseInt(params.id || "0", 10);

  const { data, isLoading, error } = trpc.orderMgmt.detail.useQuery(
    { id: orderId },
    { enabled: orderId > 0 }
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/order-management">
            <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />返回訂單列表</Button>
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
          <Link href="/order-management">
            <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />返回訂單列表</Button>
          </Link>
        </div>
        <div className="flex items-center justify-center py-20 text-muted-foreground">找不到此訂單</div>
      </div>
    );
  }

  const { order, customer, items } = data;
  const orderDate = order.orderDate ? new Date(order.orderDate).toLocaleDateString("zh-TW") : "-";
  const shippedDate = order.shippedAt ? new Date(order.shippedAt).toLocaleDateString("zh-TW") : "-";
  const total = parseFloat(String(order.total || "0"));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/order-management">
            <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />返回訂單列表</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">訂單詳情</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              訂單編號：{order.externalId || `#${order.id}`}
            </p>
          </div>
        </div>
        <Badge variant={order.shippedAt ? "default" : "secondary"} className="text-sm px-3 py-1">
          {order.shippedAt ? "已出貨" : "未出貨"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Order Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="w-4 h-4" /> 訂單資訊
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-y-3 text-sm">
              <div className="text-muted-foreground">訂單編號</div>
              <div className="font-medium font-mono">{order.externalId || "-"}</div>
              <div className="text-muted-foreground">訂單日期</div>
              <div>{orderDate}</div>
              <div className="text-muted-foreground">訂單來源</div>
              <div>{order.orderSource || "-"}</div>
              <div className="text-muted-foreground">訂單金額</div>
              <div className="font-semibold text-primary">${total.toLocaleString()}</div>
            </div>
          </CardContent>
        </Card>

        {/* Customer Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="w-4 h-4" /> 顧客資訊
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-y-3 text-sm">
              <div className="text-muted-foreground">顧客姓名</div>
              <div className="font-medium">
                {customer ? (
                  <Link href={`/customer-detail/${customer.id}`} className="text-primary hover:underline">
                    {order.customerName || "-"}
                  </Link>
                ) : (
                  order.customerName || "-"
                )}
              </div>
              <div className="text-muted-foreground">顧客手機</div>
              <div>{order.customerPhone || "-"}</div>
              <div className="text-muted-foreground">顧客信箱</div>
              <div className="break-all">{order.customerEmail || "-"}</div>
              <div className="text-muted-foreground">LINE UID</div>
              <div className="font-mono text-xs break-all">{customer?.lineUid || "-"}</div>
              <div className="text-muted-foreground">黑名單</div>
              <div>
                {customer?.blacklisted === "是" ? (
                  <Badge variant="destructive" className="text-xs">是</Badge>
                ) : (
                  customer?.blacklisted || "-"
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Payment & Shipping */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="w-4 h-4" /> 付款與配送
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-y-3 text-sm">
              <div className="text-muted-foreground">付款方式</div>
              <div>{order.paymentMethod || "-"}</div>
              <div className="text-muted-foreground">配送方式</div>
              <div>{order.shippingMethod || "-"}</div>
              <div className="text-muted-foreground">收件人姓名</div>
              <div>{order.recipientName || "-"}</div>
              <div className="text-muted-foreground">收件人手機</div>
              <div>{order.recipientPhone || "-"}</div>
              <div className="text-muted-foreground">收件人信箱</div>
              <div className="break-all">{order.recipientEmail || "-"}</div>
            </div>
          </CardContent>
        </Card>

        {/* Shipping & Logistics */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Truck className="w-4 h-4" /> 出貨與物流
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-y-3 text-sm">
              <div className="text-muted-foreground">出貨日期</div>
              <div>{shippedDate}</div>
              <div className="text-muted-foreground">出貨單號碼</div>
              <div className="font-mono">{order.shipmentNumber || "-"}</div>
              <div className="text-muted-foreground">配送編號</div>
              <div className="font-mono">{order.deliveryNumber || "-"}</div>
              <div className="text-muted-foreground">物流狀態</div>
              <div>
                {order.logisticsStatus ? (
                  <Badge variant="outline" className="text-xs">{order.logisticsStatus}</Badge>
                ) : "-"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Shipping Address */}
      {order.shippingAddress && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="w-4 h-4" /> 收貨地址
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{order.shippingAddress}</p>
          </CardContent>
        </Card>
      )}

      {/* Order Items */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">商品明細（{items.length} 項）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">無商品明細資料</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">商品名稱</TableHead>
                    <TableHead className="min-w-[100px]">SKU</TableHead>
                    <TableHead className="text-right min-w-[80px]">單價</TableHead>
                    <TableHead className="text-right min-w-[60px]">數量</TableHead>
                    <TableHead className="text-right min-w-[80px]">小計</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, idx) => (
                    <TableRow key={item.id || idx}>
                      <TableCell className="font-medium">{item.productName || "-"}</TableCell>
                      <TableCell className="font-mono text-sm">{item.productSku || "-"}</TableCell>
                      <TableCell className="text-right text-sm">
                        ${parseFloat(String(item.unitPrice || "0")).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-sm">{item.quantity || 0}</TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        ${(parseFloat(String(item.unitPrice || "0")) * (item.quantity || 0)).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50">
                    <TableCell colSpan={4} className="text-right font-semibold">合計</TableCell>
                    <TableCell className="text-right font-bold text-primary">
                      ${total.toLocaleString()}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
