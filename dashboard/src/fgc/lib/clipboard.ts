// 複製到剪貼簿 —— http fallback 必抄。
//
// Control Hub 是 http，不是 https，所以 window.isSecureContext 是 false，
// navigator.clipboard 整個是 undefined。只寫 navigator.clipboard.writeText 的程式碼
// 在開發機（localhost 被當成 secure context）永遠是好的，一到賽場就永遠是壞的，
// 而且是靜默壞掉——按鈕看起來有反應，貼上去是空的。
//
// 抄自 FTC CustomVariable.tsx:79-87 的 isSecureContext 判斷 + execCommand 後路。
// execCommand("copy") 已經 deprecated，但它是 http 頁面上唯一還能用的路徑。

export type CopyResult = "clipboard" | "execCommand" | "failed";

/** 給只在意成敗的呼叫端。 */
export async function copyOk(text: string): Promise<boolean> {
  return (await copyText(text)) !== "failed";
}

export async function copyText(text: string): Promise<CopyResult> {
  if (typeof navigator !== "undefined" && window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return "clipboard";
    } catch {
      /* 落到 execCommand */
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): CopyResult {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // 不能用 display:none / visibility:hidden——那樣選取不到，execCommand 會失敗
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok ? "execCommand" : "failed";
  } catch {
    return "failed";
  }
}
