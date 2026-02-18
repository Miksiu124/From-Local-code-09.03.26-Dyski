import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { AdminPaymentsList } from "@/components/admin/admin-payments-list";

export default async function AdminPaymentsPage() {
  const t = await getTranslations("admin");

  const [pending, approved, rejected, expired] = await Promise.all([
    db.creditPurchase.count({ where: { status: "PENDING" } }),
    db.creditPurchase.count({ where: { status: "APPROVED" } }),
    db.creditPurchase.count({ where: { status: "REJECTED" } }),
    db.creditPurchase.count({ where: { status: "EXPIRED" } }),
  ]);

  const purchases = await db.creditPurchase.findMany({
    include: {
      user: { select: { id: true, email: true, name: true } },
      creditPackage: { select: { name: true, credits: true, price: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t("creditPurchases")}</h1>

      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-center">
          <p className="text-2xl font-bold text-warning">{pending}</p>
          <p className="text-xs text-muted-foreground">{t("pending")}</p>
        </div>
        <div className="rounded-xl border border-success/30 bg-success/5 p-4 text-center">
          <p className="text-2xl font-bold text-success">{approved}</p>
          <p className="text-xs text-muted-foreground">{t("approved")}</p>
        </div>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center">
          <p className="text-2xl font-bold text-destructive">{rejected}</p>
          <p className="text-xs text-muted-foreground">{t("rejected")}</p>
        </div>
        <div className="rounded-xl border border-border bg-muted/5 p-4 text-center">
          <p className="text-2xl font-bold text-muted-foreground">{expired}</p>
          <p className="text-xs text-muted-foreground">{t("expired")}</p>
        </div>
      </div>

      <AdminPaymentsList
        purchases={purchases.map((p) => ({
          id: p.id,
          userEmail: p.user.email,
          userName: p.user.name,
          packageName: p.creditPackage.name,
          credits: p.credits,
          amount: p.amount,
          paymentMethod: p.paymentMethod,
          transactionCode: p.transactionCode,
          blikCode: p.blikCode,
          cryptoCurrency: p.cryptoCurrency,
          txId: p.txId,
          status: p.status,
          paymentProofUrl: p.paymentProofUrl,
          adminNotes: p.adminNotes,
          expirationTime: p.expirationTime.toISOString(),
          createdAt: p.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
