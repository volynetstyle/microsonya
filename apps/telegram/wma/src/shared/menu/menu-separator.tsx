export function MenuSeparator(props: { class?: string }) {
  return (
    <div
      role="separator"
      class={`menu-separator${props.class ? ` ${props.class}` : ""}`}
    />
  );
}
