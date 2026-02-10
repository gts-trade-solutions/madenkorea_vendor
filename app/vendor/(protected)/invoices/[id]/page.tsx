// app/vendor/(protected)/invoices/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";

type InvoiceCompany = {
  id: string;
  display_name: string;
  address: string | null;
  gst_number: string | null;
  email: string | null;
};

type InvoiceRow = {
  id: string;
  company_id: string;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;

  customer_name: string;
  billing_address: string | null;
  phone: string | null;
  email: string | null;
  gst_number: string | null;
  pan_number: string | null;

  notes: string | null;

  subtotal?: number | null;
  discount_total?: number | null;

  tax_type?: "CGST_SGST" | "IGST" | "NONE" | null;
  cgst_percent?: number | null;
  sgst_percent?: number | null;
  igst_percent?: number | null;

  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;

  tax_amount?: number | null;
  grand_total?: number | null;
  total_amount?: number | null;
};

type InvoiceItemRow = {
  id: string;
  product_id: string | null;
  brand: string | null;
  description: string;
  hsn: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  position: number | null;
};

const SUPPORT_EMAIL_FALLBACK = "info@madenkorea.com";

function fmtDate(d: string | null) {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("en-IN");
  } catch {
    return d;
  }
}

function formatINR(value: number) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `₹${Number(value || 0).toFixed(2)}`;
  }
}

function fmtPct(p?: number | null) {
  const n = Number(p ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  // keep as clean integer when possible
  const label = Number.isInteger(n) ? `${n}` : `${n}`;
  return ` (${label}%)`;
}

export default function InvoiceViewPage() {
  const router = useRouter();
  const params = useParams();
  const invoiceId = (params?.id as string) || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [company, setCompany] = useState<InvoiceCompany | null>(null);
  const [items, setItems] = useState<InvoiceItemRow[]>([]);

  useEffect(() => {
    const load = async () => {
      if (!invoiceId) return;

      setLoading(true);
      setError(null);

      try {
        const { data: inv, error: invErr } = await supabase
          .from("invoices")
          .select(
            `
            id,
            company_id,
            invoice_number,
            invoice_date,
            due_date,
            customer_name,
            billing_address,
            phone,
            email,
            gst_number,
            pan_number,
            notes,
            subtotal,
            discount_total,
            tax_type,
            cgst_percent,
            sgst_percent,
            igst_percent,
            cgst_amount,
            sgst_amount,
            igst_amount,
            tax_amount,
            grand_total,
            total_amount
          `,
          )
          .eq("id", invoiceId)
          .single();

        if (invErr || !inv)
          throw new Error(invErr?.message || "Invoice not found");
        setInvoice(inv as InvoiceRow);

        const { data: c, error: cErr } = await supabase
          .from("invoice_companies")
          .select("id,display_name,address,gst_number,email")
          .eq("id", (inv as any).company_id)
          .single();

        if (cErr) console.error(cErr);
        setCompany((c || null) as InvoiceCompany | null);

        const { data: its, error: itsErr } = await supabase
          .from("invoice_items")
          .select(
            "id,product_id,brand,description,hsn,quantity,unit_price,discount,position",
          )
          .eq("invoice_id", invoiceId)
          .order("position", { ascending: true });

        if (itsErr) throw new Error(itsErr.message || "Failed to load items");
        setItems((its || []) as InvoiceItemRow[]);
      } catch (e: any) {
        setError(e.message || "Failed to load invoice");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [invoiceId]);

  const sellerName = company?.display_name || "—";
  const sellerEmail = company?.email || SUPPORT_EMAIL_FALLBACK;
  const sellerAddress = company?.address || "—";
  const sellerGstin = company?.gst_number || "—";

  const invoiceNumber = invoice?.invoice_number || "—";
  const invoiceDateLabel = fmtDate(invoice?.invoice_date || null);

  const customerName = invoice?.customer_name || "—";
  const billingAddress = invoice?.billing_address || "—";
  const phone = invoice?.phone || "—";
  const customerGstin = invoice?.gst_number || "";
  const panNumber = invoice?.pan_number || "";
  const notes = invoice?.notes || "";

  const computed = useMemo(() => {
    let sub = 0;
    let disc = 0;

    for (const it of items) {
      sub += Number(it.quantity || 0) * Number(it.unit_price || 0);
      disc += Number(it.discount || 0);
    }

    const taxable = sub - disc;

    // Prefer stored totals if present (your rule)
    const taxType = (invoice?.tax_type || "CGST_SGST") as
      | "CGST_SGST"
      | "IGST"
      | "NONE";

    const cgstPercent = Number(invoice?.cgst_percent ?? 0);
    const sgstPercent = Number(invoice?.sgst_percent ?? 0);
    const igstPercent = Number(invoice?.igst_percent ?? 0);

    const cgst = Number(invoice?.cgst_amount ?? 0);
    const sgst = Number(invoice?.sgst_amount ?? 0);
    const igst = Number(invoice?.igst_amount ?? 0);

    const taxTotalStored = invoice?.tax_amount;
    const grandStored = invoice?.grand_total ?? invoice?.total_amount;

    const taxTotal =
      taxTotalStored != null
        ? Number(taxTotalStored)
        : Number((cgst + sgst + igst).toFixed(2));

    const grandTotal =
      grandStored != null
        ? Number(grandStored)
        : Number((taxable + taxTotal).toFixed(2));

    return {
      subtotal:
        invoice?.subtotal != null
          ? Number(invoice.subtotal)
          : Number(sub.toFixed(2)),
      discountTotal:
        invoice?.discount_total != null
          ? Number(invoice.discount_total)
          : Number(disc.toFixed(2)),
      taxableAmount: Number(taxable.toFixed(2)),
      taxType,
      cgstPercent,
      sgstPercent,
      igstPercent,
      cgst,
      sgst,
      igst,
      taxTotal,
      grandTotal,
    };
  }, [items, invoice]);

  if (loading) {
    return (
      <div className="container mx-auto py-10 text-sm text-muted-foreground">
        Loading invoice…
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="container mx-auto py-10">
        <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error || "Invoice not found"}
        </div>
        <div className="mt-4">
          <Button
            variant="outline"
            onClick={() => router.push("/vendor/invoices")}
          >
            ← Back to Invoices
          </Button>
        </div>
      </div>
    );
  }

  const SummaryStrip = () => (
    <div className="border border-slate-300 rounded-md bg-muted/20 p-3 text-sm">
      <div className="grid grid-cols-2 gap-y-1">
        <div className="text-muted-foreground">Subtotal</div>
        <div className="text-right font-medium">
          {formatINR(computed.subtotal)}
        </div>

        <div className="text-muted-foreground">Discount</div>
        <div className="text-right font-medium">
          {formatINR(computed.discountTotal)}
        </div>

        <div className="text-muted-foreground border-t mt-1 pt-2">
          Taxable Amount
        </div>
        <div className="text-right font-medium border-t mt-1 pt-2">
          {formatINR(computed.taxableAmount)}
        </div>

        {computed.taxType === "CGST_SGST" ? (
          <>
            <div className="text-muted-foreground">
              CGST{fmtPct(computed.cgstPercent)}
            </div>
            <div className="text-right">{formatINR(computed.cgst)}</div>

            <div className="text-muted-foreground">
              SGST{fmtPct(computed.sgstPercent)}
            </div>
            <div className="text-right">{formatINR(computed.sgst)}</div>
          </>
        ) : null}

        {computed.taxType === "IGST" ? (
          <>
            <div className="text-muted-foreground">
              IGST{fmtPct(computed.igstPercent)}
            </div>
            <div className="text-right">{formatINR(computed.igst)}</div>
          </>
        ) : null}

        <div className="col-span-2 border-t mt-2 pt-2 flex justify-between font-semibold text-base">
          <span>Invoice Amount</span>
          <span>{formatINR(computed.grandTotal)}</span>
        </div>
      </div>
    </div>
  );

  const NotesAndSignature = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 border border-slate-300 rounded-md p-3">
        <div className="font-semibold text-sm mb-2">Notes</div>
        <div className="text-xs whitespace-pre-line leading-5">
          {notes || "-"}
        </div>
      </div>

      <div className="border border-slate-300 rounded-md p-3 flex flex-col justify-between min-h-[180px]">
        <div className="text-sm font-semibold">Authorized Seal & Signature</div>
        <div className="border h-[110px] rounded-md my-3" />
        <div className="text-xs text-right">
          For <span className="font-medium">{sellerName}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white">
      <style jsx global>{`
        @media print {
          .print-hidden {
            display: none !important;
          }
          .print-wrap {
            max-width: none !important;
            padding: 0 !important;
          }
          .print-order-1 {
            order: 1;
          }
          .print-order-2 {
            order: 2;
          }
          .print-order-3 {
            order: 3;
          }
        }
      `}</style>

      {/* Controls (hidden in print) */}
      <div className="print-hidden container mx-auto max-w-5xl py-4 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => router.push("/vendor/invoices")}
        >
          ← Back
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/vendor/invoices/${invoiceId}/edit`)}
          >
            Edit
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            Print / Save PDF
          </Button>
        </div>
      </div>

      {/* Printable */}
      <div className="print-wrap mx-auto max-w-5xl px-4 pb-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-6 border-b pb-3">
          {/* Seller (order: Address -> GST -> Email) */}
          <div className="min-w-0">
            <div className="text-xl font-bold">{sellerName}</div>

            {/* 1) Address */}
            <div className="text-xs whitespace-pre-line mt-1">
              {sellerAddress}
            </div>

            {/* 2) GST */}
            <div className="text-xs text-muted-foreground mt-1">
              GSTIN: <span className="text-foreground">{sellerGstin}</span>
            </div>

            {/* 3) Email */}
            <div className="text-xs text-muted-foreground mt-1">
              Support: <span className="text-foreground">{sellerEmail}</span>
            </div>
          </div>

          {/* Right meta */}
          <div className="text-right">
            <div className="text-2xl font-bold tracking-wide">INVOICE</div>
            <div className="mt-1 text-sm space-y-1">
              <div className="flex justify-end gap-2">
                <span className="text-muted-foreground">Invoice No</span>
                <span className="font-medium">{invoiceNumber}</span>
              </div>
              <div className="flex justify-end gap-2">
                <span className="text-muted-foreground">Invoice Date</span>
                <span className="font-medium">{invoiceDateLabel}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bill to */}
        <div className="mt-3 text-sm">
          <div className="font-semibold mb-1">Bill To</div>
          <div className="font-medium">{customerName}</div>
          <div className="text-xs whitespace-pre-line">{billingAddress}</div>

          <div className="text-xs mt-2 space-y-1">
            <div>Phone: {phone}</div>
            {customerGstin ? <div>GSTIN: {customerGstin}</div> : null}
            {panNumber ? <div>PAN: {panNumber}</div> : null}
          </div>
        </div>

        {/* Body */}
        <div className="mt-4 flex flex-col gap-4">
          {/* Items */}
          <div className="print-order-1 order-1 border border-slate-300 rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-2 py-2 text-left w-[50px]">Sl.No</th>
                  <th className="px-2 py-2 text-left w-[110px]">Brand</th>
                  <th className="px-2 py-2 text-left w-auto">Description</th>
                  <th className="px-2 py-2 text-left w-[80px]">HSN</th>
                  <th className="px-2 py-2 text-right w-[60px]">Qty</th>
                  <th className="px-2 py-2 text-right w-[90px]">Rate</th>
                  <th className="px-2 py-2 text-right w-[90px]">Discount</th>
                  <th className="px-2 py-2 text-right w-[100px]">Amount</th>
                </tr>
              </thead>

              <tbody>
                {items.map((it, idx) => {
                  const amt =
                    Number(it.quantity || 0) * Number(it.unit_price || 0) -
                    Number(it.discount || 0);

                  return (
                    <tr key={it.id} className="border-t">
                      <td className="px-2 py-2">{idx + 1}</td>
                      <td className="px-2 py-2">{it.brand || "-"}</td>

                      <td className="px-2 py-2">
                        <div className="leading-4 break-words">
                          {it.description}
                        </div>
                      </td>

                      <td className="px-2 py-2">{it.hsn || "-"}</td>
                      <td className="px-2 py-2 text-right">{it.quantity}</td>
                      <td className="px-2 py-2 text-right">
                        {formatINR(Number(it.unit_price || 0))}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {formatINR(Number(it.discount || 0))}
                      </td>
                      <td className="px-2 py-2 text-right font-medium">
                        {formatINR(Number(amt))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals strip */}
          <div className="print-order-2 order-2 flex justify-end">
            <div className="w-[360px]">
              <SummaryStrip />
            </div>
          </div>

          {/* Notes + Signature */}
          <div className="print-order-3 order-3">
            <NotesAndSignature />
          </div>
        </div>
      </div>
    </div>
  );
}
