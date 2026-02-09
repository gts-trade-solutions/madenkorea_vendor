// app/vendor/(protected)/invoices/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const SUPPORT_EMAIL_FALLBACK = "info@madenkorea.com";

type InvoiceCompany = {
  id: string;
  key: string;
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

  subtotal: number; // in your DB this is NET (after discount)
  tax_amount: number;
  total_amount: number;

  notes: string | null;

  is_custom?: boolean | null;
  bill_to_address_id?: string | null;
};

type InvoiceItemRow = {
  id: string;
  invoice_id: string;
  description: string;
  hsn_sac: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  tax_percent: number;
  line_subtotal: number;
  line_tax_amount: number;
  line_total: number;
  position: number | null;

  product_id?: string | null;
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "-";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN");
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
        // 1) invoice
        const { data: inv, error: invErr } = await supabase
          .from("invoices")
          .select("*")
          .eq("id", invoiceId)
          .single();

        if (invErr || !inv)
          throw new Error(invErr?.message || "Invoice not found");
        setInvoice(inv as InvoiceRow);

        // 2) company
        const { data: comp, error: compErr } = await supabase
          .from("invoice_companies")
          .select("id, key, display_name, address, gst_number, email")
          .eq("id", (inv as InvoiceRow).company_id)
          .single();

        if (compErr) console.warn("Company fetch error", compErr);
        setCompany((comp as InvoiceCompany) || null);

        // 3) items
        const { data: its, error: itsErr } = await supabase
          .from("invoice_items")
          .select("*")
          .eq("invoice_id", invoiceId)
          .order("position", { ascending: true });

        if (itsErr) console.warn("Items fetch error", itsErr);
        setItems((its as InvoiceItemRow[]) || []);
      } catch (e: any) {
        console.error(e);
        setError(e.message || "Failed to load invoice");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [invoiceId]);

  const sellerSupportEmail = company?.email || SUPPORT_EMAIL_FALLBACK;

  // Totals from invoice row
  const totals = useMemo(() => {
    if (!invoice) return { netSubtotal: 0, tax: 0, total: 0 };
    return {
      netSubtotal: Number(invoice.subtotal || 0), // after discount (as per your save logic)
      tax: Number(invoice.tax_amount || 0),
      total: Number(invoice.total_amount || 0),
    };
  }, [invoice]);

  // NEW: discount total + gross subtotal (before discount)
  const discountTotal = useMemo(() => {
    return items.reduce((sum, it) => sum + Number(it.discount || 0), 0);
  }, [items]);

  const grossSubtotal = useMemo(() => {
    return items.reduce((sum, it) => {
      const q = Number(it.quantity || 0);
      const p = Number(it.unit_price || 0);
      return sum + q * p;
    }, 0);
  }, [items]);

  const netSubtotalFromItems = useMemo(() => {
    // gross - discount (matches invoice.subtotal when saved correctly)
    return Math.max(0, grossSubtotal - discountTotal);
  }, [grossSubtotal, discountTotal]);

  if (loading) {
    return (
      <div className="container mx-auto max-w-5xl py-8">
        <div className="text-sm text-muted-foreground">Loading invoice...</div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="container mx-auto max-w-5xl py-8 space-y-4">
        <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error || "Invoice not found"}
        </div>
        <Button
          variant="outline"
          onClick={() => router.push("/vendor/invoices")}
        >
          Back to Invoices
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl py-6 space-y-4">
      {/* Toolbar (NOT printed) */}
      <div className="flex items-center justify-between print:hidden">
        <Button
          variant="outline"
          onClick={() => router.push("/vendor/invoices")}
        >
          ← Back
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/vendor/invoices/${invoice.id}/edit`)}
          >
            Edit
          </Button>
          <Button onClick={() => window.print()}>Print / Save PDF</Button>
        </div>
      </div>

      {/* Printable invoice */}
      <Card className="print:border-0 print:shadow-none">
        <CardHeader className="print:hidden">
          <CardTitle>Invoice</CardTitle>
          <CardDescription>
            Tip: In Chrome print settings, uncheck <b>Headers and footers</b> to
            remove the top date/time and bottom URL.
          </CardDescription>
        </CardHeader>

        <CardContent className="print:p-0">
          <div className="mx-auto max-w-5xl bg-white p-6 print:p-4 print:max-w-none print:text-[11px] print:leading-tight">
            {/* Print CSS */}
            <style>{`
              @page { margin: 10mm; }
              thead { display: table-header-group; }
              tfoot { display: table-footer-group; }
              tr, td, th { page-break-inside: avoid; }
              .avoid-break { page-break-inside: avoid; }
            `}</style>

            {/* HEADER: Seller + Invoice meta (2 columns) */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 print:grid-cols-2 print:gap-3">
              {/* Seller */}
              <div className="leading-tight">
                <div className="text-xl font-semibold print:text-lg">
                  {company?.display_name || "—"}
                </div>

                <div className="mt-1 text-sm text-slate-700 print:text-xs print:leading-snug">
                  <div>
                    <span className="font-medium">Support:</span>{" "}
                    {sellerSupportEmail}
                  </div>

                  {company?.gst_number ? (
                    <div>
                      <span className="font-medium">GSTIN:</span>{" "}
                      {company.gst_number}
                    </div>
                  ) : null}

                  {company?.address ? (
                    <div className="mt-1">
                      <span className="font-medium">Address:</span>{" "}
                      <span className="whitespace-pre-line">
                        {company.address}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Invoice meta */}
              <div className="md:text-right print:text-right leading-tight">
                <div className="text-2xl font-bold tracking-tight print:text-xl">
                  INVOICE
                </div>

                <div className="mt-2 inline-grid grid-cols-2 gap-x-4 gap-y-1 text-sm print:text-xs">
                  <div className="text-slate-600">Invoice No</div>
                  <div className="font-medium">{invoice.invoice_number}</div>

                  <div className="text-slate-600">Invoice Date</div>
                  <div className="font-medium">
                    {fmtDate(invoice.invoice_date)}
                  </div>

                  {invoice.due_date ? (
                    <>
                      <div className="text-slate-600">Due Date</div>
                      <div className="font-medium">
                        {fmtDate(invoice.due_date)}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <hr className="my-4 print:my-3" />

            {/* BILL TO + TOTALS (2 columns) */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 print:grid-cols-2 print:gap-3">
              {/* Bill To */}
              <div className="leading-tight">
                <div className="text-sm font-semibold print:text-xs">
                  Bill To
                </div>

                <div className="mt-1 text-sm print:text-xs print:leading-snug">
                  <div className="font-medium">{invoice.customer_name}</div>

                  {invoice.billing_address ? (
                    <div className="mt-1 whitespace-pre-line text-slate-700">
                      {invoice.billing_address}
                    </div>
                  ) : null}

                  <div className="mt-1 grid grid-cols-1 gap-y-0.5 text-slate-700">
                    {invoice.phone ? (
                      <div>
                        <span className="font-medium">Phone:</span>{" "}
                        {invoice.phone}
                      </div>
                    ) : null}
                    {invoice.gst_number ? (
                      <div>
                        <span className="font-medium">GSTIN:</span>{" "}
                        {invoice.gst_number}
                      </div>
                    ) : null}
                    {invoice.pan_number ? (
                      <div>
                        <span className="font-medium">PAN:</span>{" "}
                        {invoice.pan_number}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Totals */}
              <div className="md:justify-self-end print:justify-self-end w-full md:max-w-xs avoid-break">
                <div className="rounded-md border p-3 print:p-2">
                  {/* Gross subtotal (before discount) */}
                  <div className="flex justify-between text-sm print:text-xs">
                    <span className="text-slate-600">Subtotal</span>
                    <span className="font-medium">
                      {grossSubtotal.toFixed(2)}
                    </span>
                  </div>

                  {/* Discount total */}
                  <div className="flex justify-between text-sm print:text-xs mt-1">
                    <span className="text-slate-600">Discount</span>
                    <span className="font-medium">
                      {discountTotal.toFixed(2)}
                    </span>
                  </div>

                  {/* Net subtotal (after discount) */}
                  <div className="flex justify-between text-sm print:text-xs mt-1">
                    <span className="text-slate-600">Net Subtotal</span>
                    <span className="font-medium">
                      {netSubtotalFromItems.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex justify-between text-sm print:text-xs mt-1">
                    <span className="text-slate-600">Tax</span>
                    <span className="font-medium">{totals.tax.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between text-base print:text-sm font-semibold mt-2">
                    <span>Total</span>
                    <span>{totals.total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ITEMS TABLE */}
            <div className="mt-4 print:mt-3">
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm print:text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-2 py-2 text-left w-[40px]">#</th>
                      <th className="px-2 py-2 text-left">Description</th>
                      <th className="px-2 py-2 text-left w-[90px]">HSN</th>
                      <th className="px-2 py-2 text-right w-[60px]">Qty</th>
                      <th className="px-2 py-2 text-right w-[90px]">Unit</th>
                      <th className="px-2 py-2 text-right w-[90px]">Disc</th>
                      <th className="px-2 py-2 text-right w-[70px]">Tax%</th>
                      <th className="px-2 py-2 text-right w-[110px]">Amount</th>
                    </tr>
                  </thead>

                  <tbody>
                    {items.length === 0 ? (
                      <tr className="border-t">
                        <td
                          colSpan={8}
                          className="px-3 py-3 text-sm text-slate-600"
                        >
                          No items.
                        </td>
                      </tr>
                    ) : (
                      items.map((it, idx) => (
                        <tr key={it.id} className="border-t">
                          <td className="px-2 py-1 align-top">{idx + 1}</td>
                          <td className="px-2 py-1 align-top leading-snug">
                            {it.description}
                          </td>
                          <td className="px-2 py-1 align-top">
                            {it.hsn_sac || "-"}
                          </td>
                          <td className="px-2 py-1 align-top text-right">
                            {it.quantity}
                          </td>
                          <td className="px-2 py-1 align-top text-right">
                            {Number(it.unit_price || 0).toFixed(2)}
                          </td>
                          <td className="px-2 py-1 align-top text-right">
                            {Number(it.discount || 0).toFixed(2)}
                          </td>
                          <td className="px-2 py-1 align-top text-right">
                            {Number(it.tax_percent || 0).toFixed(2)}
                          </td>
                          <td className="px-2 py-1 align-top text-right">
                            {Number(it.line_total || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* NOTES */}
            {invoice.notes ? (
              <div className="mt-4 print:mt-3 text-sm print:text-xs">
                <div className="font-semibold">Notes</div>
                <div className="mt-1 whitespace-pre-line text-slate-700 leading-snug">
                  {invoice.notes}
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
