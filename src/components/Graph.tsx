import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "@quartz-community/types";
import { classNames } from "../util/lang";
import { i18n } from "../i18n";
import style from "./styles/graph.scss";
// @ts-expect-error - inline script imported as string by esbuild loader
import script from "./scripts/graph.inline.ts";

export interface D3Config {
  drag: boolean;
  zoom: boolean;
  depth: number;
  scale: number;
  repelForce: number;
  centerForce: number;
  linkDistance: number;
  fontSize: number;
  opacityScale: number;
  removeTags: string[];
  showTags: boolean;
  focusOnHover?: boolean;
  enableRadial?: boolean;
  // Highlight the current page's node.
  highlightCurrentNode?: boolean;
  // Override the highlight color: a CSS color (theme var or hex), or { light, dark } variants.
  // Defaults to the theme highlight color, var(--textHighlight).
  currentNodeHighlightColor?: string | { light?: string; dark?: string };
  // Adds an X close button. Only applies to the modal views (global / local modal).
  showCloseButton?: boolean;
  // Adds +/- depth controls. Only applies to the modal views.
  showDepthControl?: boolean;
  // Upper bound for the depth controls.
  depthControlMaxDepth?: number;
  // Let "+" pop to "All" (whole vault) past max depth. A graph whose initial depth is -1
  // (the global graph) can always reach "All" regardless of this flag.
  depthControlAllowAllAfterMax?: boolean;
}

export interface GraphOptions {
  localGraph?: Partial<D3Config>;
  globalGraph?: Partial<D3Config>;
  // Adds a magnifier icon that opens a zoomable, depth-adjustable modal of the local graph.
  enableLocalModal?: boolean;
  // Inherits the localGraph config, allows overrides.
  localModalGraph?: Partial<D3Config>;
}

const defaultOptions: GraphOptions = {
  localGraph: {
    drag: true,
    zoom: true,
    depth: 1,
    scale: 1.1,
    repelForce: 0.5,
    centerForce: 0.3,
    linkDistance: 30,
    fontSize: 0.6,
    opacityScale: 1,
    showTags: true,
    removeTags: [],
    focusOnHover: false,
    enableRadial: false,
    highlightCurrentNode: false,
  },
  globalGraph: {
    drag: true,
    zoom: true,
    depth: -1,
    scale: 0.9,
    repelForce: 0.5,
    centerForce: 0.2,
    linkDistance: 30,
    fontSize: 0.6,
    opacityScale: 1,
    showTags: true,
    removeTags: [],
    focusOnHover: true,
    enableRadial: true,
    highlightCurrentNode: false,
    showCloseButton: false,
    showDepthControl: false,
    depthControlMaxDepth: 5,
    depthControlAllowAllAfterMax: true, // always reachable since the global initial depth is -1
  },
  enableLocalModal: false,
  localModalGraph: {
    // Inherits localGraph; these are the modal-specific overrides.
    focusOnHover: true,
    highlightCurrentNode: true,
    currentNodeHighlightColor: "var(--textHighlight)",
    showCloseButton: false,
    showDepthControl: false,
    depthControlMaxDepth: 5,
    depthControlAllowAllAfterMax: false,
  },
};

export default ((userOpts?: Partial<GraphOptions>) => {
  const Graph: QuartzComponent = ({ displayClass, cfg }: QuartzComponentProps) => {
    const localGraph = { ...defaultOptions.localGraph, ...userOpts?.localGraph };
    const globalGraph = { ...defaultOptions.globalGraph, ...userOpts?.globalGraph };
    const enableLocalModal = userOpts?.enableLocalModal ?? defaultOptions.enableLocalModal;
    // Local modal inherits the sidebar localGraph, then the modal defaults, then user overrides.
    const localModalGraph = {
      ...localGraph,
      ...defaultOptions.localModalGraph,
      ...userOpts?.localModalGraph,
    };

    const depthLabel = (depth?: number) =>
      typeof depth === "number" && depth < 0 ? "All" : String(depth ?? 1);

    const depthControls = (initialLabel: string) => (
      <div class="graph-depth-controls" aria-label="Graph depth">
        <button
          class="graph-depth-button graph-depth-decrease"
          aria-label="Decrease depth"
          type="button"
        >
          &#8722;
        </button>
        <span class="graph-depth-label" aria-live="polite">
          {initialLabel}
        </span>
        <button
          class="graph-depth-button graph-depth-increase"
          aria-label="Increase depth"
          type="button"
        >
          +
        </button>
      </div>
    );

    const closeButton = () => (
      <button class="modal-close" aria-label="Close graph" type="button">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    );

    return (
      <div class={classNames(displayClass, "graph")}>
        <h3>{i18n(cfg.locale ?? "en-US").components.graph.title}</h3>
        <div class="graph-outer">
          <div class="graph-container" data-cfg={JSON.stringify(localGraph)}></div>
          {enableLocalModal && (
            <button class="local-graph-icon" aria-label="Zoom into Local Graph">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="10.5" cy="10.5" r="7" />
                <line x1="21" y1="21" x2="15.8" y2="15.8" />
                <line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />
                <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
              </svg>
            </button>
          )}
          <button class="global-graph-icon" aria-label="Global Graph">
            <svg
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              xmlnsXlink="http://www.w3.org/1999/xlink"
              x="0px"
              y="0px"
              viewBox="0 0 55 55"
              fill="currentColor"
              xmlSpace="preserve"
            >
              <path
                d="M49,0c-3.309,0-6,2.691-6,6c0,1.035,0.263,2.009,0.726,2.86l-9.829,9.829C32.542,17.634,30.846,17,29,17
                s-3.542,0.634-4.898,1.688l-7.669-7.669C16.785,10.424,17,9.74,17,9c0-2.206-1.794-4-4-4S9,6.794,9,9s1.794,4,4,4
                c0.74,0,1.424-0.215,2.019-0.567l7.669,7.669C21.634,21.458,21,23.154,21,25s0.634,3.542,1.688,4.897L10.024,42.562
                C8.958,41.595,7.549,41,6,41c-3.309,0-6,2.691-6,6s2.691,6,6,6s6-2.691,6-6c0-1.035-0.263-2.009-0.726-2.86l12.829-12.829
                c1.106,0.86,2.44,1.436,3.898,1.619v10.16c-2.833,0.478-5,2.942-5,5.91c0,3.309,2.691,6,6,6s6-2.691,6-6c0-2.967-2.167-5.431-5-5.91
                v-10.16c1.458-0.183,2.792-0.759,3.898-1.619l7.669,7.669C41.215,39.576,41,40.26,41,41c0,2.206,1.794,4,4,4s4-1.794,4-4
                s-1.794-4-4-4c-0.74,0-1.424,0.215-2.019,0.567l-7.669-7.669C36.366,28.542,37,26.846,37,25s-0.634-3.542-1.688-4.897l9.665-9.665
                C46.042,11.405,47.451,12,49,12c3.309,0,6-2.691,6-6S52.309,0,49,0z M11,9c0-1.103,0.897-2,2-2s2,0.897,2,2s-0.897,2-2,2
                S11,10.103,11,9z M6,51c-2.206,0-4-1.794-4-4s1.794-4,4-4s4,1.794,4,4S8.206,51,6,51z M33,49c0,2.206-1.794,4-4,4s-4-1.794-4-4
                s1.794-4,4-4S33,46.794,33,49z M29,31c-3.309,0-6-2.691-6-6s2.691-6,6-6s6,2.691,6,6S32.309,31,29,31z M47,41c0,1.103-0.897,2-2,2
                s-2-0.897-2-2s0.897-2,2-2S47,39.897,47,41z M49,10c-2.206,0-4-1.794-4-4s1.794-4,4-4s4,1.794,4,4S51.206,10,49,10z"
              />
            </svg>
          </button>
        </div>
        {enableLocalModal && (
          <div class="local-graph-outer">
            <div class="local-graph-container" data-cfg={JSON.stringify(localModalGraph)}></div>
            {localModalGraph.showDepthControl && depthControls(depthLabel(localModalGraph.depth))}
            {localModalGraph.showCloseButton && closeButton()}
          </div>
        )}
        <div class="global-graph-outer">
          <div class="global-graph-container" data-cfg={JSON.stringify(globalGraph)}></div>
          {globalGraph.showDepthControl && depthControls(depthLabel(globalGraph.depth))}
          {globalGraph.showCloseButton && closeButton()}
        </div>
      </div>
    );
  };

  Graph.css = style;
  Graph.afterDOMLoaded = script;

  return Graph;
}) satisfies QuartzComponentConstructor;
