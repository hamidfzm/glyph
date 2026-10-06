/** Mount a rendered body the way the document viewer does, inside its marked
 *  scroller, so `documentBody()` resolves it. Returns the body element. */
export function mountDocumentBody(html = "", className = "markdown-body"): HTMLElement {
  const scroller = document.createElement("div");
  scroller.setAttribute("data-scroll-container", "");
  const body = document.createElement("div");
  body.className = className;
  body.innerHTML = html;
  scroller.appendChild(body);
  document.body.appendChild(scroller);
  return body;
}
