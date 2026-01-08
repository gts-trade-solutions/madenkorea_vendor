"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type InventoryStatus =
  | "IN_STOCK"
  | "INVOICED"
  | "DEMO"
  | "SOLD"
  | "RETURNED"
  | "OUT_OF_STOCK";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

function toYmd(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function addYears(date: Date, years: number) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function pad3(n: number) {
  return String(n).padStart(3, "0");
}

function ymdToCompact(ymd: string) {
  return (ymd || "").replaceAll("-", "");
}

function priceToCodePart(price: number) {
  if (!Number.isFinite(price)) return "";
  return String(Math.round(price * 100)); // 2 decimals
}

function first2Letters(name: string) {
  const letters = (name || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters.slice(0, 2) || "XX").padEnd(2, "X");
}

function rand4() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

export function UnitUpsertDialog({
  open,
  onOpenChange,
  mode,
  vendorId,
  productId,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "create" | "edit";
  vendorId: string;
  productId: string;
  initial?: {
    id: string;
    unit_code: string;
    manufacture_date?: string | null;
    expiry_date?: string | null;
    status: InventoryStatus;
  } | null;
  onSaved: () => void;
}) {
  const isEdit = mode === "edit";
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saving, setSaving] = useState(false);

  // meta fetched (create)
  const [productName, setProductName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [productCode, setProductCode] = useState("");
  const [brandCode, setBrandCode] = useState("");

  // form fields
  const [unitCode, setUnitCode] = useState("");
  const [manufactureDate, setManufactureDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [editStatus, setEditStatus] = useState<InventoryStatus>("IN_STOCK");

  // internal price (NOT editable) – used for unit_code generation + insert
  const [salePrice, setSalePrice] = useState<number>(0);

  // batch count (create)
  const [unitsCount, setUnitsCount] = useState<number>(1);

  // Load on open
  useEffect(() => {
    if (!open) return;

    // EDIT MODE
    if (isEdit && initial) {
      setUnitCode(initial.unit_code ?? "");
      setManufactureDate((initial.manufacture_date ?? "") as string);
      setExpiryDate((initial.expiry_date ?? "") as string);
      setEditStatus(initial.status ?? "IN_STOCK");
      setUnitsCount(1);
      return;
    }

    // CREATE MODE
    (async () => {
      setLoadingMeta(true);
      try {
        const today = new Date();
        setManufactureDate(toYmd(addYears(today, -1)));
        setExpiryDate(toYmd(addYears(today, 2)));
        setUnitsCount(1);

        // product: MUST prefer price
        const { data: p, error: pErr } = await supabase
          .from("products")
          .select("id,name,product_code,price,price,brand_id")
          .eq("id", productId)
          .single();

        if (pErr) throw pErr;

        const pName = (p as any)?.name ?? "";
        setProductName(pName);

        const pCode =
          (p as any)?.product_code?.toString()?.trim() ||
          `${first2Letters(pName)}${rand4()}`;
        setProductCode(pCode);

        const sp = (p as any)?.price;
        const pr = (p as any)?.price;

        // Use price (as requested). If missing, fallback to price but warn.
        if (sp == null) {
          toast.warning("price is null for this product. Using price as fallback.");
        }
        const final = sp != null ? Number(sp) : Number(pr ?? 0);
        setSalePrice(Number.isFinite(final) ? final : 0);

        // brand
        const brandId = (p as any)?.brand_id;
        if (brandId) {
          const { data: b, error: bErr } = await supabase
            .from("brands")
            .select("id,name,brand_code")
            .eq("id", brandId)
            .single();

          if (bErr) throw bErr;

          const bName = (b as any)?.name ?? "";
          setBrandName(bName);

          const bCode =
            (b as any)?.brand_code?.toString()?.trim() ||
            `${first2Letters(bName)}${rand4()}`;
          setBrandCode(bCode);
        } else {
          setBrandName("");
          setBrandCode("XX" + rand4());
        }
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || "Failed to load product/brand data");
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, [open, isEdit, initial, productId]);

  // base code for create (batch)
  const batchBaseCode = useMemo(() => {
    if (!productCode || !brandCode || !manufactureDate || !expiryDate) return "";
    const mfg = ymdToCompact(manufactureDate);
    const exp = ymdToCompact(expiryDate);
    const pr = priceToCodePart(salePrice); // uses SALE PRICE (not editable)
    return `${productCode}${brandCode}${mfg}${exp}${pr}`;
  }, [productCode, brandCode, manufactureDate, expiryDate, salePrice]);

  const previewCodes = useMemo(() => {
    if (!batchBaseCode) return [];
    const n = Math.min(Math.max(Math.floor(unitsCount || 1), 1), 3);
    return Array.from({ length: n }).map((_, i) => `${batchBaseCode}-${pad3(i + 1)}`);
  }, [batchBaseCode, unitsCount]);

  // Create batch
  const createBatch = async () => {
    if (!vendorId || !productId) return;

    const count = Math.max(1, Math.floor(unitsCount || 1));

    if (!batchBaseCode) return toast.error("Unit code not ready. Please check dates/codes.");
    if (!manufactureDate) return toast.error("Manufacture date is required.");
    if (!expiryDate) return toast.error("Expiry date is required.");

    setSaving(true);
    try {
      const rows = Array.from({ length: count }).map((_, i) => ({
        vendor_id: vendorId,
        product_id: productId,
        unit_code: `${batchBaseCode}-${pad3(i + 1)}`,
        manufacture_date: manufactureDate,
        expiry_date: expiryDate,
        // keep price stored but NOT editable; set from price
        price: salePrice,
        status: "IN_STOCK" as InventoryStatus,
      }));

      const { error } = await supabase.from("inventory_units").insert(rows);
      if (error) throw error;

      toast.success(`Created ${count} unit(s)`);
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to create units");
    } finally {
      setSaving(false);
    }
  };

  // Save edit (single)
  const saveEdit = async () => {
    if (!initial?.id) return;

    const nextUnitCode = unitCode.trim();

    if (!nextUnitCode) return toast.error("Unit code is required.");
    if (!manufactureDate) return toast.error("Manufacture date is required.");

    setSaving(true);
    try {
      // Optional friendly duplicate check
      if (nextUnitCode !== initial.unit_code) {
        const { data: dup } = await supabase
          .from("inventory_units")
          .select("id")
          .eq("vendor_id", vendorId)
          .eq("unit_code", nextUnitCode)
          .limit(1);

        if (dup && dup.length > 0) {
          toast.error("This unit code already exists. Please use a unique unit code.");
          return;
        }
      }

      const { error } = await supabase
        .from("inventory_units")
        .update({
          unit_code: nextUnitCode, // ✅ now editable
          manufacture_date: manufactureDate,
          expiry_date: expiryDate || null,
          status: editStatus,
          // ❌ no price update here
        })
        .eq("id", initial.id)
        .eq("vendor_id", vendorId);

      if (error) throw error;

      toast.success("Unit updated");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Unit" : "Create Unit Batch"}</DialogTitle>
        </DialogHeader>

        {isEdit ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-1">Unit code</div>
              <Input
                value={unitCode}
                onChange={(e) => setUnitCode(e.target.value)}
                placeholder="Enter unit code"
              />
              <div className="text-xs text-muted-foreground mt-1">
                Must be unique per vendor.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">Manufacture Date</div>
                <Input
                  type="date"
                  value={manufactureDate}
                  onChange={(e) => setManufactureDate(e.target.value)}
                />
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Expiry Date</div>
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Status</div>
              <Select value={editStatus} onValueChange={(v) => setEditStatus(v as InventoryStatus)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent className="bg-background">
                  <SelectItem value="IN_STOCK">IN_STOCK</SelectItem>
                  <SelectItem value="INVOICED">INVOICED</SelectItem>
                  <SelectItem value="DEMO">DEMO</SelectItem>
                  <SelectItem value="SOLD">SOLD</SelectItem>
                  <SelectItem value="RETURNED">RETURNED</SelectItem>
                  <SelectItem value="OUT_OF_STOCK">OUT_OF_STOCK</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* ✅ price removed from edit */}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">Product Code (auto)</div>
                <Input value={productCode} readOnly placeholder="Loading…" />
                {productName ? (
                  <div className="text-xs text-muted-foreground mt-1">{productName}</div>
                ) : null}
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Brand Code (auto)</div>
                <Input value={brandCode} readOnly placeholder="Loading…" />
                {brandName ? (
                  <div className="text-xs text-muted-foreground mt-1">{brandName}</div>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">Manufacture Date</div>
                <Input
                  type="date"
                  value={manufactureDate}
                  onChange={(e) => setManufactureDate(e.target.value)}
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Default: today - 1 year
                </div>
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Expiry Date</div>
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Default: today + 2 years
                </div>
              </div>
            </div>

            {/* ✅ price shown (read-only) but not editable */}
            <div>
              <div className="text-sm font-medium mb-1">Sale price (auto)</div>
              <Input value={Number.isFinite(salePrice) ? String(salePrice) : "0"} readOnly />
              <div className="text-xs text-muted-foreground mt-1">
                Fetched from products.price (fallback to price if missing).
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">Units count (batch)</div>
                <Input
                  type="number"
                  value={unitsCount}
                  onChange={(e) => setUnitsCount(Number(e.target.value))}
                  min="1"
                />
                <div className="text-xs text-muted-foreground mt-1">Example: 10</div>
              </div>

              <div>
                <div className="text-sm font-medium mb-1">Batch Base Code (auto)</div>
                <Input value={batchBaseCode} readOnly placeholder="Auto-generated" />
                <div className="text-xs text-muted-foreground mt-1">
                  product_code + brand_code + mfg + exp + price
                </div>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Unit code preview</div>
              <div className="rounded-md border p-2 text-sm font-mono space-y-1">
                {batchBaseCode ? (
                  previewCodes.map((x) => <div key={x}>{x}</div>)
                ) : (
                  <div className="text-muted-foreground">Loading…</div>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Saved as BatchBaseCode-001, -002, ...
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>

          {isEdit ? (
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          ) : (
            <Button onClick={createBatch} disabled={saving || loadingMeta || !batchBaseCode}>
              {saving ? "Creating…" : "Create units"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
