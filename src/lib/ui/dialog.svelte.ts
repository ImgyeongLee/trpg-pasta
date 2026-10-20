// 앱 안 확인 창. `await dialog.ask({...})`가 고른 버튼의 id를 돌려준다 (Esc·바깥 클릭은 "cancel").

export interface DialogAction {
  id: string;
  label: string;
  variant?: "primary" | "danger" | "default";
}

export interface DialogRequest {
  title: string;
  message: string;
  actions: DialogAction[];
}

class DialogState {
  current = $state<(DialogRequest & { resolve: (id: string) => void }) | null>(null);

  ask(request: DialogRequest): Promise<string> {
    // 이미 떠 있는 창이 있으면 취소로 닫고 새 창을 띄운다.
    this.current?.resolve("cancel");
    return new Promise((resolve) => {
      this.current = { ...request, resolve };
    });
  }

  answer(id: string) {
    const current = this.current;
    this.current = null;
    current?.resolve(id);
  }
}

export const dialog = new DialogState();
