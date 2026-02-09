// app/vendor/(protected)/invoices/[id]/edit/page.tsx
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const SUPPORT_EMAIL_FALLBACK = "info@madenkorea.com";

// ✅ IMPORTANT: change if your products table / price column differs
const PRODUCTS_TABLE = "products";
const PRODUCTS_PRICE_COLUMN = "price";

type InvoiceCompany = {
  id: string;
  key: string;
  display_name: string;
  address: string | null;
  gst_number: string | null;
  email: string | null;
};

type ProductSuggestion = {
  id: string;
  name: string;
  price: number | null;
};

type InvoiceAddress = {
  id: string;
  vendor_id: string;
  label: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  created_at?: string;
};

type InvoiceItem = {
  id: string; // local id for React key
  description: string;
  product_id?: string | null;
  hsn_sac: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax_percent: number;
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

  subtotal: number;
  tax_amount: number;
  total_amount: number;

  notes: string | null;

  is_custom?: boolean | null;
  bill_to_address_id?: string | null;
};

function createEmptyItem(): InvoiceItem {
  return {
    id: crypto.randomUUID(),
    description: "",
    product_id: null,
    hsn_sac: "",
    quantity: 1,
    unit_price: 0,
    discount: 0,
    tax_percent: 0,
  };
}

export default function EditInvoicePage() {
  const router = useRouter();
  const params = useParams();
  const invoiceId = (params?.id as string) || "";

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [companies, setCompanies] = useState<InvoiceCompany[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState<boolean>(false);

  // ✅ Mode + addresses
  const [isCustom, setIsCustom] = useState<boolean>(true);
  const [addresses, setAddresses] = useState<InvoiceAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");

  // ✅ Suggestions per-row
  const [productSuggestionsByItem, setProductSuggestionsByItem] = useState<
    Record<string, ProductSuggestion[]>
  >({});
  const [activeSuggestForItemId, setActiveSuggestForItemId] = useState<
    string | null
  >(null);

  // --- Invoice form state ---
  const [companyId, setCompanyId] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");

  const [customerName, setCustomerName] = useState<string>("");
  const [billingAddress, setBillingAddress] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [gstNumber, setGstNumber] = useState<string>("");
  const [panNumber, setPanNumber] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const [items, setItems] = useState<InvoiceItem[]>([createEmptyItem()]);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === companyId) ?? null,
    [companies, companyId],
  );

  const sellerSupportEmail = selectedCompany?.email || SUPPORT_EMAIL_FALLBACK;

  // --- Totals calculation ---
  const { subtotal, taxAmount, totalAmount } = useMemo(() => {
    let sub = 0;
    let tax = 0;

    for (const item of items) {
      const lineSubtotal = item.quantity * item.unit_price - item.discount;
      const lineTax = (lineSubtotal * item.tax_percent) / 100;
      sub += lineSubtotal;
      tax += lineTax;
    }

    return {
      subtotal: Number(sub.toFixed(2)),
      taxAmount: Number(tax.toFixed(2)),
      totalAmount: Number((sub + tax).toFixed(2)),
    };
  }, [items]);

  // --- item operations ---
  const updateItem = (id: string, patch: Partial<InvoiceItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    );
  };

  const addItem = () => setItems((prev) => [...prev, createEmptyItem()]);

  const removeItem = (id: string) => {
    setItems((prev) =>
      prev.length <= 1 ? prev : prev.filter((it) => it.id !== id),
    );
  };

  // --- Address selection -> prefill fields ---
  const applyAddressToCustomerFields = (addr: InvoiceAddress) => {
    setCustomerName(addr.name || "");
    setPhone(addr.phone || "");
    setEmail(addr.email || "");
    setGstNumber(addr.gstin || "");

    const fullAddress = [
      addr.address_line1,
      addr.address_line2,
      `${addr.city}, ${addr.state} - ${addr.pincode}`,
      addr.country || "India",
    ]
      .filter(Boolean)
      .join("\n");

    setBillingAddress(fullAddress);
  };

  // --- Fetch suggestions per-row ---
  const fetchProductSuggestions = async (itemId: string, query: string) => {
    if (isCustom) return;

    const q = query.trim();
    if (q.length < 2) {
      setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: [] }));
      return;
    }

    const selectCols = `id,name,${PRODUCTS_PRICE_COLUMN}`;
    const { data, error } = await supabase
      .from(PRODUCTS_TABLE)
      .select(selectCols)
      .ilike("name", `%${q}%`)
      .limit(10);

    if (error) {
      console.error("Product suggestion error", error);
      setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: [] }));
      return;
    }

    const mapped =
      (data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        price:
          row?.[PRODUCTS_PRICE_COLUMN] == null
            ? null
            : Number(row?.[PRODUCTS_PRICE_COLUMN]),
      })) ?? [];

    setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: mapped }));
  };

  // --- Load companies (same as new page) ---
  useEffect(() => {
    const loadCompanies = async () => {
      setLoadingCompanies(true);
      const { data, error } = await supabase
        .from("invoice_companies")
        .select("id, key, display_name, address, gst_number, email")
        .order("display_name", { ascending: true });

      if (error) console.error("Error loading invoice_companies", error);
      else setCompanies((data || []) as InvoiceCompany[]);

      setLoadingCompanies(false);
    };

    loadCompanies();
  }, []);

  // --- Load addresses (vendor scoped) ---
  useEffect(() => {
    const loadAddresses = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const vendorId = user.id;

      const { data, error } = await supabase
        .from("invoice_addresses")
        .select("*")
        .eq("vendor_id", vendorId)
        .order("created_at", { ascending: false });

      if (error) console.error("Error loading invoice_addresses", error);
      else setAddresses((data || []) as InvoiceAddress[]);
    };

    loadAddresses();
  }, []);

  // --- Load invoice + items ---
  useEffect(() => {
    const loadInvoice = async () => {
      if (!invoiceId) return;
      setLoading(true);
      setError(null);

      try {
        const { data: inv, error: invErr } = await supabase
          .from("invoices")
          .select("*")
          .eq("id", invoiceId)
          .single();

        if (invErr || !inv) throw new Error(invErr?.message || "Invoice not found");

        const invoice = inv as InvoiceRow;

        // fill form state
        setCompanyId(invoice.company_id || "");
        setInvoiceNumber(invoice.invoice_number || "");
        setInvoiceDate(invoice.invoice_date || "");
        setDueDate(invoice.due_date || "");

        setCustomerName(invoice.customer_name || "");
        setBillingAddress(invoice.billing_address || "");
        setPhone(invoice.phone || "");
        setEmail(invoice.email || "");
        setGstNumber(invoice.gst_number || "");
        setPanNumber(invoice.pan_number || "");
        setNotes(invoice.notes || "");

        setIsCustom(invoice.is_custom ?? true);
        setSelectedAddressId(invoice.bill_to_address_id ?? "");

        // items
        const { data: its, error: itsErr } = await supabase
          .from("invoice_items")
          .select(
            "id, product_id, description, hsn_sac, quantity, unit_price, discount, tax_percent, position",
          )
          .eq("invoice_id", invoiceId)
          .order("position", { ascending: true });

        if (itsErr) {
          console.error("Items load error", itsErr);
          setItems([createEmptyItem()]);
        } else {
          const mapped: InvoiceItem[] =
            (its || []).map((r: any) => ({
              id: r.id || crypto.randomUUID(), // keep DB id as key
              description: r.description || "",
              product_id: r.product_id ?? null,
              hsn_sac: r.hsn_sac || "",
              quantity: Number(r.quantity || 0),
              unit_price: Number(r.unit_price || 0),
              discount: Number(r.discount || 0),
              tax_percent: Number(r.tax_percent || 0),
            })) ?? [];

          setItems(mapped.length > 0 ? mapped : [createEmptyItem()]);
        }
      } catch (e: any) {
        console.error(e);
        setError(e.message || "Failed to load invoice");
      } finally {
        setLoading(false);
      }
    };

    loadInvoice();
  }, [invoiceId]);

  // --- Save updates (simple + reliable): update invoice, delete items, re-insert items ---
  const handleSave = async () => {
    setError(null);
    setSuccessMessage(null);

    if (!companyId) return setError("Please select the invoice company.");
    if (!invoiceNumber.trim())
      return setError("Please enter an invoice number.");
    if (!customerName.trim()) return setError("Please enter customer name.");
    if (!billingAddress.trim())
      return setError("Please enter billing address.");
    if (!phone.trim()) return setError("Please enter customer mobile number.");
    if (items.every((it) => !it.description.trim()))
      return setError("Please enter at least one line item description.");

    if (!isCustom) {
      const invalid = items
        .filter((it) => it.description.trim())
        .some((it) => !it.product_id);
      if (invalid) {
        return setError(
          "Web generated invoice: please select product names from suggestions for all items.",
        );
      }
    }

    setSaving(true);

    try {
      // 1) update invoice row
      const { error: invUpdErr } = await supabase
        .from("invoices")
        .update({
          company_id: companyId,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate || null,
          due_date: dueDate || null,

          customer_name: customerName,
          billing_address: billingAddress || null,
          phone: phone || null,
          email: email || null,
          gst_number: gstNumber || null,
          pan_number: panNumber || null,

          subtotal,
          tax_amount: taxAmount,
          total_amount: totalAmount,

          notes: notes || null,

          is_custom: isCustom,
          bill_to_address_id: selectedAddressId || null,
        })
        .eq("id", invoiceId);

      if (invUpdErr) throw new Error(invUpdErr.message || "Failed to update invoice");

      // 2) delete all items then re-insert (keeps it simple)
      const { error: delErr } = await supabase
        .from("invoice_items")
        .delete()
        .eq("invoice_id", invoiceId);

      if (delErr) throw new Error(delErr.message || "Failed to refresh invoice items");

      const itemsToInsert = items
        .filter((it) => it.description.trim())
        .map((it, index) => {
          const lineSubtotal = it.quantity * it.unit_price - it.discount;
          const lineTax = (lineSubtotal * it.tax_percent) / 100;
          const lineTotal = lineSubtotal + lineTax;

          return {
            invoice_id: invoiceId,
            product_id: it.product_id || null,
            description: it.description,
            hsn_sac: it.hsn_sac || null,
            quantity: it.quantity,
            unit_price: it.unit_price,
            discount: it.discount,
            tax_percent: it.tax_percent,
            line_subtotal: Number(lineSubtotal.toFixed(2)),
            line_tax_amount: Number(lineTax.toFixed(2)),
            line_total: Number(lineTotal.toFixed(2)),
            position: index,
          };
        });

      if (itemsToInsert.length > 0) {
        const { error: insErr } = await supabase
          .from("invoice_items")
          .insert(itemsToInsert);

        if (insErr) throw new Error(insErr.message || "Failed to save invoice items");
      }

      setSuccessMessage("Invoice updated successfully.");
      router.push(`/vendor/invoices/${invoiceId}`);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto max-w-5xl py-8">
        <div className="text-sm text-muted-foreground">Loading invoice...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl py-6 space-y-6">
      {/* Mode + Address (same behavior as New) */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <input
                id="is_custom"
                type="checkbox"
                checked={isCustom}
                onChange={(e) => {
                  const next = e.target.checked;
                  setIsCustom(next);

                  // Reset product_id when switching modes
                  setItems((prev) => prev.map((it) => ({ ...it, product_id: null })));

                  setProductSuggestionsByItem({});
                  setActiveSuggestForItemId(null);
                }}
                className="h-4 w-4"
              />
              <label htmlFor="is_custom" className="text-sm font-medium">
                Custom Invoice (manual items)
              </label>
            </div>

            <div className="text-xs text-muted-foreground">
              {isCustom
                ? "You can type any item name and price."
                : "Type to search website products. Select from suggestions to lock product name; unit price auto-fills but you can edit."}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Bill To Address (prefill)</Label>
                        <div className="flex items-center justify-between">
            
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => router.push("/vendor/addresses")}
                          >
                            Manage Addresses
                          </Button>
                        </div>
            <select
              value={selectedAddressId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedAddressId(id);

                const addr = addresses.find((a) => a.id === id);
                if (!addr) return;
                applyAddressToCustomerFields(addr);
              }}
              className="w-full border rounded-md px-3 py-2"
            >
              <option value="">Select saved address</option>
              {addresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} — {a.city}
                </option>
              ))}
            </select>

            <p className="text-xs text-muted-foreground">
              Select an address to auto-fill Customer Details and Billing Address.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Main form */}
      <Card>
        <CardHeader>
          <CardTitle>Edit Invoice</CardTitle>
          <CardDescription>Update invoice and line items.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="rounded-md border border-green-500 bg-green-50 px-3 py-2 text-sm text-green-700">
              {successMessage}
            </div>
          )}

          {/* Company + basic invoice info */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Invoice Company</Label>
              <Select
                disabled={loadingCompanies}
                value={companyId || undefined}
                onValueChange={setCompanyId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="mt-2 rounded-md border bg-muted/30 p-2 text-xs text-slate-700">
                <div className="font-medium">
                  Seller: {selectedCompany?.display_name || "-"}
                </div>
                <div>Support Email: {sellerSupportEmail}</div>
                <div>GSTIN: {selectedCompany?.gst_number || "-"}</div>
                <div className="whitespace-pre-line">
                  Address: {selectedCompany?.address || "-"}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Invoice Number</Label>
              <Input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label>Invoice Date</Label>
              <Input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {/* Customer info */}
          <div className="border-t pt-4">
            <h3 className="mb-2 text-base font-semibold">Customer Details</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Customer Name</Label>
                <Input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>Customer Email (optional)</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>Mobile Number</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>GST No (Customer)</Label>
                <Input
                  value={gstNumber}
                  onChange={(e) => setGstNumber(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>PAN Number (Customer)</Label>
                <Input
                  value={panNumber}
                  onChange={(e) => setPanNumber(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-3 space-y-1">
              <Label>Billing Address</Label>
              <Textarea
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          {/* Line items */}
          <div className="border-t pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold">Invoice Items</h3>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                + Add Item
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-2 py-2 text-left">
                      {isCustom ? "Description" : "Product (Website)"}
                    </th>
                    <th className="px-2 py-2 text-left">HSN/SAC</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-2 py-2 text-right">Unit Price</th>
                    <th className="px-2 py-2 text-right">Discount</th>
                    <th className="px-2 py-2 text-right">Tax %</th>
                    <th className="px-2 py-2 text-right">Line Total</th>
                    <th className="px-2 py-2 text-center">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {items.map((item) => {
                    const lineSubtotal =
                      item.quantity * item.unit_price - item.discount;
                    const lineTax = (lineSubtotal * item.tax_percent) / 100;
                    const lineTotal = lineSubtotal + lineTax;

                    return (
                      <tr key={item.id} className="border-t">
                        {/* ✅ User friendly product selector */}
                        <td className="px-2 py-1 align-top relative">
                          <div className="flex flex-col gap-1">
                            <Input
                              value={item.description}
                              onFocus={() => {
                                if (!isCustom) setActiveSuggestForItemId(item.id);
                              }}
                              onBlur={() => {
                                setTimeout(() => {
                                  setActiveSuggestForItemId((prev) =>
                                    prev === item.id ? null : prev,
                                  );
                                  setProductSuggestionsByItem((prev) => ({
                                    ...prev,
                                    [item.id]: [],
                                  }));
                                }, 150);
                              }}
                              onChange={(e) => {
                                const v = e.target.value;

                                if (isCustom) {
                                  updateItem(item.id, { description: v });
                                  return;
                                }

                                updateItem(item.id, {
                                  description: v,
                                  product_id: null,
                                });

                                setActiveSuggestForItemId(item.id);
                                fetchProductSuggestions(item.id, v);
                              }}
                              placeholder={
                                isCustom ? "Item / service description" : "Search product..."
                              }
                            />

                            {!isCustom && item.product_id && (
                              <div className="text-[11px] text-muted-foreground">
                                Selected from website products ✅
                              </div>
                            )}
                          </div>

                          {!isCustom &&
                            activeSuggestForItemId === item.id &&
                            (productSuggestionsByItem[item.id]?.length || 0) > 0 && (
                              <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-sm max-h-60 overflow-auto">
                                {productSuggestionsByItem[item.id].map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-3"
                                    onMouseDown={(ev) => ev.preventDefault()}
                                    onClick={() => {
                                      updateItem(item.id, {
                                        description: p.name,
                                        product_id: p.id,
                                        unit_price:
                                          p.price == null ? item.unit_price : Number(p.price),
                                      });

                                      setProductSuggestionsByItem((prev) => ({
                                        ...prev,
                                        [item.id]: [],
                                      }));
                                      setActiveSuggestForItemId(null);
                                    }}
                                  >
                                    <span className="truncate">{p.name}</span>
                                    <span className="text-xs text-slate-600">
                                      {p.price != null ? Number(p.price).toFixed(2) : ""}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}

                          {!isCustom && item.description.trim() && !item.product_id && (
                            <div className="mt-1 text-xs text-amber-600">
                              Select from suggestions
                            </div>
                          )}
                        </td>

                        <td className="px-2 py-1 align-top">
                          <Input
                            value={item.hsn_sac}
                            onChange={(e) =>
                              updateItem(item.id, { hsn_sac: e.target.value })
                            }
                            placeholder="HSN / SAC"
                          />
                        </td>

                        <td className="px-2 py-1 align-top">
                          <Input
                            type="number"
                            min={0}
                            value={item.quantity.toString()}
                            onChange={(e) =>
                              updateItem(item.id, {
                                quantity: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>

                        {/* ✅ auto-filled but editable */}
                        <td className="px-2 py-1 align-top">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.unit_price.toString()}
                            onChange={(e) =>
                              updateItem(item.id, {
                                unit_price: Number(e.target.value) || 0,
                              })
                            }
                          />
                          {!isCustom && (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              Auto-filled from product, you can edit
                            </div>
                          )}
                        </td>

                        <td className="px-2 py-1 align-top">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.discount.toString()}
                            onChange={(e) =>
                              updateItem(item.id, {
                                discount: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>

                        <td className="px-2 py-1 align-top">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.tax_percent.toString()}
                            onChange={(e) =>
                              updateItem(item.id, {
                                tax_percent: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>

                        <td className="px-2 py-1 align-top text-right align-middle">
                          {lineTotal.toFixed(2)}
                        </td>

                        <td className="px-2 py-1 text-center align-middle">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(item.id)}
                            disabled={items.length <= 1}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="mt-4 flex flex-col items-end space-y-1 text-sm">
              <div className="flex w-full max-w-sm justify-between">
                <span>Subtotal</span>
                <span>{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex w-full max-w-sm justify-between">
                <span>Tax</span>
                <span>{taxAmount.toFixed(2)}</span>
              </div>
              <div className="flex w-full max-w-sm justify-between font-semibold">
                <span>Total</span>
                <span>{totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="border-t pt-4">
            <div className="space-y-1">
              <Label>Notes / Internal Reference</Label>
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any internal notes for this invoice"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/vendor/invoices/${invoiceId}`)}
            >
              Cancel
            </Button>

            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
