// 每頁一個錯誤邊界。
//
// 為什麼一定要有：這份儀表板有 20 幾個 Canvas 面板各自 rAF、各自從 LogStore
// 讀值。任何一個面板對一個「這一份 log 剛好沒有」的 key 做了 .toFixed()，
// React 18 的預設行為是**整棵樹卸載**——畫面全白，連頂欄的 ws age 都不見了。
// 在 pit 裡那看起來跟「儀表板當掉」一模一樣，而真相可能只是某一格算錯。
//
// 所以邊界畫在「頁」這一層：壞掉的那一頁換成一張可讀的卡片，
// 頂欄（模式徽章、ws age、8080 燈、錄影行數）永遠還在，
// 而且可以按 D/S/T/C/A 直接切到另一頁繼續用。
//
// 卡片上一定要有 Build tag 與原始錯誤訊息：賽場上回報「儀表板壞了」沒有用，
// 「B7f3a2 的 shooter 頁在 dip 表 toFixed of undefined」才修得動。

import { Component, type ErrorInfo, type ReactNode } from "react";
import { liveLog } from "../../lib/LogStore";
import { K } from "../../lib/fgcKeys";

interface Props {
  /** 出事時顯示在卡片上的位置名稱（分頁 label）。 */
  where: string;
  /** 換頁時重置：把這個設成分頁 id，React 會重建整個邊界。 */
  children: ReactNode;
}

interface State {
  err: Error | null;
  stack: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null, stack: "" };

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    // console 是唯一會留在 DevTools 裡的證據；卡片上只放摘要
    console.error(`[FGC] ${this.props.where} 面板崩潰：`, err, info.componentStack);
    this.setState({ stack: (info.componentStack ?? "").split("\n").slice(1, 6).join("\n").trim() });
  }

  private reset = () => this.setState({ err: null, stack: "" });

  render(): ReactNode {
    const { err, stack } = this.state;
    if (!err) return this.props.children;
    const build = liveLog.latestStr(K.build) || "（沒有 Build tag）";
    return (
      <div className="fgc-crash">
        <div className="fgc-crash-card">
          <h2>
            <span className="fgc-glyph err">■</span>
            {this.props.where}這一頁崩潰了
          </h2>
          <p className="lead">
            其餘分頁與頂欄都還活著——按分頁列或快捷鍵切過去就能繼續用。
            機器人端沒有受到任何影響（這一頁只讀資料）。
          </p>
          <div className="fgc-crash-detail">
            <div className="row">
              <span className="k">錯誤</span>
              <code>{err.message || String(err)}</code>
            </div>
            <div className="row">
              <span className="k">Build</span>
              <code>{build}</code>
            </div>
            {stack && (
              <div className="row">
                <span className="k">位置</span>
                <pre>{stack}</pre>
              </div>
            )}
          </div>
          <button className="fgc-crash-retry" onClick={this.reset}>
            重試這一頁
          </button>
        </div>
      </div>
    );
  }
}
