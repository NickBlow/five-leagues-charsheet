import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { useEffect } from "react";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
    ],
    links: [
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        href: "/favicon.png",
        type: "image/png",
      },
    ],
  }),
  shellComponent: RootDocument,
});

const dragDropBootScript = `(function(){
  function hasFiles(dataTransfer){
    if(!dataTransfer){return false}
    if(dataTransfer.files&&dataTransfer.files.length>0){return true}
    if(dataTransfer.types&&typeof dataTransfer.types.indexOf==='function'){return dataTransfer.types.indexOf('Files')!==-1}
    return Array.isArray(dataTransfer.types)&&dataTransfer.types.indexOf('Files')!==-1
  }
  function getImageFiles(dataTransfer){
    if(!dataTransfer||!dataTransfer.files){return []}
    return Array.from(dataTransfer.files).filter(function(file){return !file.type||file.type.indexOf('image/')===0})
  }
  function preventNavigation(event){
    if(!hasFiles(event.dataTransfer)){return}
    event.preventDefault()
    event.stopPropagation()
    if(event.dataTransfer){event.dataTransfer.dropEffect='copy'}
    return false
  }
  function forwardDrop(event){
    var files=getImageFiles(event.dataTransfer)
    if(files.length===0){return}
    event.preventDefault()
    event.stopPropagation()
    window.dispatchEvent(new CustomEvent('five-leagues:image-drop',{detail:{files:files}}))
    return false
  }
  window.ondragover=preventNavigation
  window.ondrop=forwardDrop
  document.ondragover=preventNavigation
  document.ondrop=forwardDrop
  document.documentElement.ondragover=preventNavigation
  document.documentElement.ondrop=forwardDrop
  if(document.body){
    document.body.ondragover=preventNavigation
    document.body.ondrop=forwardDrop
  }
  document.addEventListener('dragenter',preventNavigation,true)
  document.addEventListener('dragover',preventNavigation,true)
  document.addEventListener('drop',forwardDrop,true)
  window.addEventListener('dragenter',preventNavigation,true)
  window.addEventListener('dragover',preventNavigation,true)
  window.addEventListener('drop',forwardDrop,true)
})();`;

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const getImageFiles = (dataTransfer: DataTransfer | null) => {
      if (!dataTransfer) {
        return [] as File[];
      }

      return Array.from(dataTransfer.files).filter((file) => file.type.startsWith("image/"));
    };

    const forwardDrop = (event: DragEvent) => {
      const files = getImageFiles(event.dataTransfer ?? null);
      if (files.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent("five-leagues:image-drop", { detail: { files } }));
    };

    const preventNavigation = (event: DragEvent) => {
      if (getImageFiles(event.dataTransfer ?? null).length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };

    const body = document.body;

    const options = { capture: true } as const;
    window.addEventListener("dragenter", preventNavigation, options);
    window.addEventListener("dragover", preventNavigation, options);
    window.addEventListener("drop", forwardDrop, options);
    document.addEventListener("dragenter", preventNavigation, options);
    document.addEventListener("dragover", preventNavigation, options);
    document.addEventListener("drop", forwardDrop, options);
    body.addEventListener("dragenter", preventNavigation, options);
    body.addEventListener("dragover", preventNavigation, options);
    body.addEventListener("drop", forwardDrop, options);

    return () => {
      window.removeEventListener("dragenter", preventNavigation, options);
      window.removeEventListener("dragover", preventNavigation, options);
      window.removeEventListener("drop", forwardDrop, options);
      document.removeEventListener("dragenter", preventNavigation, options);
      document.removeEventListener("dragover", preventNavigation, options);
      document.removeEventListener("drop", forwardDrop, options);
      body.removeEventListener("dragenter", preventNavigation, options);
      body.removeEventListener("dragover", preventNavigation, options);
      body.removeEventListener("drop", forwardDrop, options);
    };
  }, []);

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: dragDropBootScript }} />
        <HeadContent />
      </head>
      <body>
        <div className="page-backdrop" />
        {children}
        {import.meta.env.DEV ? (
          <TanStackDevtools
            config={{
              position: "bottom-right",
            }}
            plugins={[
              {
                name: "TanStack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        ) : null}
        <Scripts />
      </body>
    </html>
  );
}
