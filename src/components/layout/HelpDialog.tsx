import { SHORTCUTS } from "../../app/shortcuts";
import { useUi } from "../../state/ui";
import { Dialog, Kbd } from "../ui";

export function HelpDialog() {
  const open = useUi((s) => s.helpOpen);
  return (
    <Dialog open={open} onClose={() => useUi.setState({ helpOpen: false })} title="Keyboard shortcuts">
      <div className="px-5 py-3">
        <table className="w-full text-sm">
          <tbody>
            {SHORTCUTS.map(([k, d]) => (
              <tr key={k} className="border-b border-line last:border-0">
                <td className="py-2 pr-4">
                  <Kbd>{k}</Kbd>
                </td>
                <td className="py-2 text-muted">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">Tip: double-click any sentence to start reading from that word. Alt+click works too.</p>
      </div>
    </Dialog>
  );
}
