// @ts-nocheck
import {
  removeAllChildren,
  getBasePath,
  getFullSlugFromUrl,
  simplifySlug,
  resolveBasePath,
} from "@quartz-community/utils";

(function () {
  function getSlugFromUrl() {
    var slug = getFullSlugFromUrl();
    var base = getBasePath();
    if (base && slug.startsWith(base.replace(/^\//, ""))) {
      slug = slug.slice(base.replace(/^\//, "").length);
      if (slug.startsWith("/")) slug = slug.slice(1);
    }
    return slug;
  }

  function loadScript(src) {
    var existing = document.querySelector('script[src="' + src + '"]');
    if (existing) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.crossOrigin = "anonymous";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  Promise.all([
    loadScript("https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"),
    loadScript("https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.js"),
  ])
    .then(function () {
      initGraph();
    })
    .catch(function (err) {
      console.error("[Graph] Failed to load libraries:", err);
      var containers = document.querySelectorAll(".graph-container");
      for (var i = 0; i < containers.length; i++) {
        containers[i].textContent = "Graph could not load. Check your network connection.";
        containers[i].style.display = "flex";
        containers[i].style.alignItems = "center";
        containers[i].style.justifyContent = "center";
        containers[i].style.color = "var(--gray)";
        containers[i].style.fontSize = "0.9rem";
      }
    });

  function initGraph() {
    var d3 = window.d3;
    var PIXI = window.PIXI;

    if (!d3 || !PIXI) {
      console.error("[Graph] Libraries not loaded");
      return;
    }

    var localStorageKey = "graph-visited";

    function getVisited() {
      return new Set(JSON.parse(localStorage.getItem(localStorageKey) || "[]"));
    }

    function addToVisited(slug) {
      var visited = getVisited();
      visited.add(slug);
      localStorage.setItem(localStorageKey, JSON.stringify(Array.from(visited)));
    }

    // Resolves CSS color values containing calc()/var() that PixiJS cannot parse.
    // Uses a temp DOM element so the browser's CSS engine evaluates the expression.
    function resolveColor(value, fallback) {
      if (!value) return fallback;
      var el = document.createElement("div");
      el.style.color = value;
      el.style.position = "absolute";
      el.style.visibility = "hidden";
      document.body.appendChild(el);
      var resolved = getComputedStyle(el).color;
      el.remove();
      return resolved || fallback;
    }

    // Like resolveColor, but drops any alpha channel so a translucent theme color
    // (e.g. --textHighlight) renders as a solid node fill rather than a faint wash.
    function resolveOpaqueColor(value, fallback) {
      var resolved = resolveColor(value, fallback);
      var m = resolved && resolved.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
      return m ? "rgb(" + m[1] + ", " + m[2] + ", " + m[3] + ")" : resolved;
    }

    // Resolves the current-node highlight color. Accepts a CSS color string or { light, dark }
    // variants (picked by the active theme). Alpha is stripped so the node renders solid.
    function resolveHighlightColor(value) {
      var raw = value;
      if (value && typeof value === "object") {
        var isDark = document.documentElement.getAttribute("saved-theme") === "dark";
        raw = (isDark ? value.dark : value.light) || value.light || value.dark;
      }
      if (!raw) raw = "var(--textHighlight)";
      return resolveOpaqueColor(raw, "#fff236");
    }

    async function renderGraph(graph, fullSlug, renderGeneration, opts) {
      opts = opts || {};
      var slug = simplifySlug(fullSlug);
      if (slug === "") slug = "index";
      var visited = getVisited();
      removeAllChildren(graph);

      if (renderGeneration !== undefined && renderGeneration !== currentRenderGeneration) {
        console.log("[Graph] Stale render, skipping");
        return function () {};
      }

      var config = JSON.parse(graph.dataset["cfg"] || "{}");
      var enableDrag = config.drag;
      var enableZoom = config.zoom;
      var depth = config.depth;
      var scale = config.scale || 1;
      var repelForce = config.repelForce || 0.5;
      var centerForce = config.centerForce || 0.3;
      var linkDistance = config.linkDistance || 30;
      var fontSize = config.fontSize || 0.6;
      var opacityScale = config.opacityScale || 1;
      var removeTags = config.removeTags || [];
      var showTags = config.showTags;
      var focusOnHover = config.focusOnHover;
      var enableRadial = config.enableRadial;
      var highlightCurrentNode = config.highlightCurrentNode;

      var data;
      try {
        var dataRaw = await fetchData;
        data = new Map();
        for (var key in dataRaw) {
          data.set(simplifySlug(key), dataRaw[key]);
        }
      } catch (err) {
        console.error("[Graph] Error loading data:", err);
        return function () {};
      }

      var width = graph.offsetWidth;
      var height = Math.max(graph.offsetHeight, 250);

      var links = [];
      var allTags = [];
      var validLinks = new Set(data.keys());

      data.forEach(function (details, source) {
        var outgoing = details.links || [];
        for (var i = 0; i < outgoing.length; i++) {
          var dest = simplifySlug(outgoing[i]);
          if (validLinks.has(dest)) {
            links.push({ source: source, target: dest });
          }
        }

        if (showTags) {
          var tags = details.tags || [];
          for (var i = 0; i < tags.length; i++) {
            var tag = tags[i];
            if (removeTags.indexOf(tag) === -1) {
              var tagSlug = simplifySlug("tags/" + tag);
              if (allTags.indexOf(tagSlug) === -1) {
                allTags.push(tagSlug);
              }
              links.push({ source: source, target: tagSlug });
            }
          }
        }
      });

      var neighbourhood = new Set();
      if (depth >= 0) {
        var queue = [slug];
        var seen = new Set([slug]);
        for (var d = 0; d <= depth && queue.length > 0; d++) {
          var nextQueue = [];
          for (var qi = 0; qi < queue.length; qi++) {
            var cur = queue[qi];
            neighbourhood.add(cur);
            for (var li = 0; li < links.length; li++) {
              var link = links[li];
              if (link.source === cur && !seen.has(link.target)) {
                seen.add(link.target);
                nextQueue.push(link.target);
              }
              if (link.target === cur && !seen.has(link.source)) {
                seen.add(link.source);
                nextQueue.push(link.source);
              }
            }
          }
          queue = nextQueue;
        }
      } else {
        validLinks.forEach(function (id) {
          neighbourhood.add(id);
        });
        for (var i = 0; i < allTags.length; i++) {
          neighbourhood.add(allTags[i]);
        }
      }

      var nodes = [];
      var nodeMap = new Map();
      neighbourhood.forEach(function (url) {
        var isTag = url.startsWith("tags/");
        var text = isTag ? "#" + url.substring(5) : data.get(url)?.title || url;
        var nodeTags = isTag ? [] : data.get(url)?.tags || [];
        var node = {
          id: url,
          text: text,
          tags: nodeTags,
          x: Math.random() * width - width / 2,
          y: Math.random() * height - height / 2,
          vx: 0,
          vy: 0,
        };
        nodes.push(node);
        nodeMap.set(url, node);
      });

      var graphLinks = [];
      for (var i = 0; i < links.length; i++) {
        var link = links[i];
        if (neighbourhood.has(link.source) && neighbourhood.has(link.target)) {
          var sourceNode = nodeMap.get(link.source);
          var targetNode = nodeMap.get(link.target);
          if (sourceNode && targetNode) {
            graphLinks.push({ source: sourceNode, target: targetNode });
          }
        }
      }

      var styles = getComputedStyle(document.documentElement);
      var secondary = resolveColor(styles.getPropertyValue("--secondary").trim(), "#c792ea");
      var tertiary = resolveColor(styles.getPropertyValue("--tertiary").trim(), "#82aaff");
      var gray = resolveColor(styles.getPropertyValue("--gray").trim(), "#6c6c6c");
      var lightgray = resolveColor(styles.getPropertyValue("--lightgray").trim(), "#d4d4d4");
      var dark = resolveColor(styles.getPropertyValue("--dark").trim(), "#1a1a1a");
      var light = resolveColor(styles.getPropertyValue("--light").trim(), "#f5f5f5");
      var bodyFont = styles.getPropertyValue("--bodyFont").trim() || "inherit";
      var currentNodeColor = highlightCurrentNode
        ? resolveHighlightColor(config.currentNodeHighlightColor)
        : null;

      var app = new PIXI.Application();
      await app.init({
        width: width,
        height: height,
        antialias: true,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        eventMode: "static",
      });

      graph.appendChild(app.canvas);

      var stage = new PIXI.Container();
      app.stage.addChild(stage);

      var simulation = d3
        .forceSimulation(nodes)
        .force("charge", d3.forceManyBody().strength(-100 * repelForce))
        .force("center", d3.forceCenter().strength(centerForce))
        .force("link", d3.forceLink(graphLinks).distance(linkDistance))
        .force(
          "collide",
          d3
            .forceCollide()
            .radius(function (d) {
              var numLinks = 0;
              for (var i = 0; i < graphLinks.length; i++) {
                if (graphLinks[i].source.id === d.id || graphLinks[i].target.id === d.id) {
                  numLinks++;
                }
              }
              return 2 + Math.sqrt(numLinks);
            })
            .iterations(3),
        );

      if (enableRadial) {
        var radius = (Math.min(width, height) / 2) * 0.8;
        simulation.force("radial", d3.forceRadial(radius).strength(0.2));
      }

      var linkContainer = new PIXI.Container();
      var nodesContainer = new PIXI.Container();
      var labelsContainer = new PIXI.Container();
      stage.addChild(linkContainer);
      stage.addChild(nodesContainer);
      stage.addChild(labelsContainer);

      var nodeRenderData = [];
      var linkRenderData = [];
      var hoveredNodeId = null;
      var hoveredNeighbours = new Set();
      var dragStartTime = 0;
      var dragging = false;
      var currentTransform = d3.zoomIdentity;
      var fitTimeout = null;
      var currentNodeLabel = null;
      var zoomInHandler = null;
      var zoomOutHandler = null;

      function nodeRadius(d) {
        var numLinks = 0;
        for (var i = 0; i < graphLinks.length; i++) {
          if (graphLinks[i].source.id === d.id || graphLinks[i].target.id === d.id) {
            numLinks++;
          }
        }
        return 2 + Math.sqrt(numLinks);
      }

      function nodeColor(d) {
        var isCurrent = d.id === slug;
        if (isCurrent) {
          return secondary;
        } else if (visited.has(d.id) || d.id.startsWith("tags/")) {
          return tertiary;
        } else {
          return gray;
        }
      }

      function updateHoverInfo(newHoveredId) {
        hoveredNodeId = newHoveredId;

        if (newHoveredId === null) {
          hoveredNeighbours = new Set();
          for (var i = 0; i < nodeRenderData.length; i++) {
            nodeRenderData[i].active = false;
          }
          for (var i = 0; i < linkRenderData.length; i++) {
            linkRenderData[i].active = false;
          }
        } else {
          hoveredNeighbours = new Set();

          for (var i = 0; i < linkRenderData.length; i++) {
            var linkData = linkRenderData[i].simulationData;
            if (linkData.source.id === newHoveredId || linkData.target.id === newHoveredId) {
              hoveredNeighbours.add(linkData.source.id);
              hoveredNeighbours.add(linkData.target.id);
              linkRenderData[i].active = true;
            } else {
              linkRenderData[i].active = false;
            }
          }

          hoveredNeighbours.add(newHoveredId);

          for (var i = 0; i < nodeRenderData.length; i++) {
            if (hoveredNeighbours.has(nodeRenderData[i].simulationData.id)) {
              nodeRenderData[i].active = true;
            } else {
              nodeRenderData[i].active = false;
            }
          }
        }
      }

      function renderLinks() {
        for (var i = 0; i < linkRenderData.length; i++) {
          var linkData = linkRenderData[i];
          var alpha = 1;
          if (hoveredNodeId !== null) {
            alpha = linkData.active ? 1 : 0.2;
          }
          linkData.alpha = alpha;
          linkData.color = linkData.active ? gray : lightgray;
        }
      }

      function renderLabels() {
        var defaultScale = 1 / scale;
        var activeScale = defaultScale * 1.1;

        for (var i = 0; i < nodeRenderData.length; i++) {
          var nodeData = nodeRenderData[i];
          if (hoveredNodeId === nodeData.simulationData.id) {
            nodeData.label.alpha = 1;
            nodeData.label.scale.set(activeScale);
          } else {
            nodeData.label.scale.set(defaultScale);
          }
        }
      }

      function renderNodes() {
        for (var i = 0; i < nodeRenderData.length; i++) {
          var nodeData = nodeRenderData[i];
          var alpha = 1;
          if (hoveredNodeId !== null && focusOnHover) {
            alpha = nodeData.active ? 1 : 0.2;
          }
          nodeData.gfx.alpha = alpha;
        }
      }

      function renderPixiFromD3() {
        renderNodes();
        renderLinks();
        renderLabels();
      }

      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var nodeId = node.id;
        var isTagNode = nodeId.startsWith("tags/");
        var isCurrentNode = nodeId === slug;
        var radius = nodeRadius(node);
        var color = nodeColor(node);

        // Emphasize the current page's node with a distinct color and an always-visible label so
        // it's easy to spot — without changing its size.
        var emphasized = highlightCurrentNode && isCurrentNode;
        var nodeFill = isTagNode ? light : emphasized ? currentNodeColor : color;

        var label = new PIXI.Text({
          text: node.text,
          style: {
            fontSize: fontSize * 15,
            fill: dark,
            fontFamily: bodyFont,
            fontWeight: emphasized ? "bold" : "normal",
          },
          resolution: window.devicePixelRatio * 4,
        });
        label.anchor.set(0.5, 1.2);
        label.alpha = emphasized ? 1 : 0;
        label.scale.set(1 / scale);
        labelsContainer.addChild(label);
        if (emphasized) currentNodeLabel = label;

        var gfx = new PIXI.Graphics();
        gfx.circle(0, 0, radius);
        gfx.fill({ color: nodeFill });
        if (isTagNode) {
          gfx.stroke({ width: 2, color: tertiary });
        }

        gfx.eventMode = "static";
        gfx.cursor = "pointer";
        gfx.label = nodeId;

        (function (n, g, labelRef) {
          var oldLabelOpacity = 0;
          g.on("pointerover", function (e) {
            updateHoverInfo(n.id);
            oldLabelOpacity = labelRef.alpha;
            if (!dragging) {
              renderPixiFromD3();
            }
          });

          g.on("pointerleave", function () {
            updateHoverInfo(null);
            labelRef.alpha = oldLabelOpacity;
            if (!dragging) {
              renderPixiFromD3();
            }
          });
        })(node, gfx, label);

        nodesContainer.addChild(gfx);

        nodeRenderData.push({
          simulationData: node,
          gfx: gfx,
          label: label,
          color: color,
          alpha: 1,
          active: false,
        });
      }

      for (var i = 0; i < graphLinks.length; i++) {
        var link = graphLinks[i];
        var gfx = new PIXI.Graphics();
        gfx.eventMode = "none";
        linkContainer.addChild(gfx);

        linkRenderData.push({
          simulationData: link,
          gfx: gfx,
          color: lightgray,
          alpha: 1,
          active: false,
        });
      }

      if (enableDrag) {
        var dragSubject = function (event) {
          var mouseX = (event.x - currentTransform.x) / currentTransform.k;
          var mouseY = (event.y - currentTransform.y) / currentTransform.k;

          for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var dx = mouseX - n.x - width / 2;
            var dy = mouseY - n.y - height / 2;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var rad = nodeRadius(n);
            if (dist < rad + 5) {
              return n;
            }
          }
          return null;
        };

        var dragStarted = function (event) {
          if (!event.active) simulation.alphaTarget(1).restart();
          event.subject.fx = event.subject.x;
          event.subject.fy = event.subject.y;
          var mouseSimX = (event.x - currentTransform.x) / currentTransform.k - width / 2;
          var mouseSimY = (event.y - currentTransform.y) / currentTransform.k - height / 2;
          event.subject.__dragOffset = {
            x: mouseSimX - event.subject.x,
            y: mouseSimY - event.subject.y,
          };
          dragStartTime = Date.now();
          dragging = true;
          hoveredNodeId = event.subject.id;
        };

        var dragDragged = function (event) {
          var mouseSimX = (event.x - currentTransform.x) / currentTransform.k - width / 2;
          var mouseSimY = (event.y - currentTransform.y) / currentTransform.k - height / 2;
          event.subject.fx = mouseSimX - event.subject.__dragOffset.x;
          event.subject.fy = mouseSimY - event.subject.__dragOffset.y;
        };

        var dragEnded = function (event) {
          if (!event.active) simulation.alphaTarget(0);
          event.subject.fx = null;
          event.subject.fy = null;
          dragging = false;
          updateHoverInfo(null);
          renderPixiFromD3();

          if (Date.now() - dragStartTime < 500) {
            var target = resolveBasePath(event.subject.id);
            window.location.href = target;
          }
        };

        var drag = d3
          .drag()
          .container(app.canvas)
          .subject(dragSubject)
          .on("start", dragStarted)
          .on("drag", dragDragged)
          .on("end", dragEnded);

        d3.select(app.canvas).call(drag);
      } else {
        for (var i = 0; i < nodeRenderData.length; i++) {
          (function (nodeData) {
            nodeData.gfx.on("click", function () {
              var target = resolveBasePath(nodeData.simulationData.id);
              window.location.href = target;
            });
          })(nodeRenderData[i]);
        }
      }

      // Computes a zoom transform that fits the current node layout into the canvas, filling
      // roughly `fill` of it (so labels are readable and there is room to expand the depth).
      function computeFitTransform(fill) {
        if (!nodes.length) return null;
        var minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          if (n.x == null || n.y == null) continue;
          if (n.x < minX) minX = n.x;
          if (n.x > maxX) maxX = n.x;
          if (n.y < minY) minY = n.y;
          if (n.y > maxY) maxY = n.y;
        }
        if (!isFinite(minX)) return null;
        var gw = Math.max(maxX - minX, 1);
        var gh = Math.max(maxY - minY, 1);
        // Nodes are drawn at (sim + width/2, height/2), so the bbox center in stage coords:
        var cx = (minX + maxX) / 2 + width / 2;
        var cy = (minY + maxY) / 2 + height / 2;
        var k = (fill || 0.5) * Math.min(width / gw, height / gh);
        k = Math.max(0.25, Math.min(k, 4));
        var tx = width / 2 - k * cx;
        var ty = height / 2 - k * cy;
        return d3.zoomIdentity.translate(tx, ty).scale(k);
      }

      if (enableZoom) {
        var zoomed = function (event) {
          currentTransform = event.transform;
          if (opts.onTransform) opts.onTransform(currentTransform);
          stage.scale.set(currentTransform.k, currentTransform.k);
          stage.position.set(currentTransform.x, currentTransform.y);

          var newScale = currentTransform.k * opacityScale;
          var scaleOpacity = Math.max((newScale - 1) / 3.75, 0);

          var activeLabels = [];
          for (var i = 0; i < nodeRenderData.length; i++) {
            if (nodeRenderData[i].active) {
              activeLabels.push(nodeRenderData[i].label);
            }
          }

          for (var i = 0; i < labelsContainer.children.length; i++) {
            var label = labelsContainer.children[i];
            if (label === currentNodeLabel) continue;
            if (activeLabels.indexOf(label) === -1) {
              label.alpha = scaleOpacity;
            }
          }
        };

        var zoom = d3
          .zoom()
          .extent([
            [0, 0],
            [width, height],
          ])
          .scaleExtent([0.25, 4])
          .on("zoom", zoomed);

        d3.select(app.canvas).call(zoom);

        // Local modal: open at a comfortable zoom. On the first open we fit the layout once it
        // has settled; on depth changes the caller passes the preserved transform so the zoom
        // stays put.
        if (opts.initialTransform) {
          d3.select(app.canvas).call(zoom.transform, opts.initialTransform);
        } else if (opts.fitView) {
          fitTimeout = setTimeout(function () {
            if (stopAnimation) return;
            var t = computeFitTransform(opts.fitFill);
            if (t) d3.select(app.canvas).call(zoom.transform, t);
          }, opts.fitDelay || 600);
        }

        // Zoom +/- buttons (modal only): drive d3's zoom so they stay in sync with scroll/pinch
        // and respect the same scale limits. Each click eases by a fixed factor.
        if (opts.zoomInButton && opts.zoomOutButton) {
          zoomInHandler = function (e) {
            e.stopPropagation();
            d3.select(app.canvas).transition().duration(150).call(zoom.scaleBy, 1.4);
          };
          zoomOutHandler = function (e) {
            e.stopPropagation();
            d3.select(app.canvas)
              .transition()
              .duration(150)
              .call(zoom.scaleBy, 1 / 1.4);
          };
          opts.zoomInButton.addEventListener("click", zoomInHandler);
          opts.zoomOutButton.addEventListener("click", zoomOutHandler);
        }
      }

      var stopAnimation = false;
      function animate() {
        if (stopAnimation) return;

        for (var i = 0; i < nodeRenderData.length; i++) {
          var n = nodeRenderData[i];
          var x = n.simulationData.x;
          var y = n.simulationData.y;
          if (x != null && y != null) {
            n.gfx.position.set(x + width / 2, y + height / 2);
            if (n.label) {
              n.label.position.set(x + width / 2, y + height / 2);
            }
          }
        }

        for (var i = 0; i < linkRenderData.length; i++) {
          var l = linkRenderData[i];
          var linkData = l.simulationData;
          var sx = linkData.source.x;
          var sy = linkData.source.y;
          var tx = linkData.target.x;
          var ty = linkData.target.y;
          if (sx != null && sy != null && tx != null && ty != null) {
            l.gfx.clear();
            l.gfx.moveTo(sx + width / 2, sy + height / 2);
            l.gfx.lineTo(tx + width / 2, ty + height / 2);
            l.gfx.stroke({ alpha: l.alpha, width: 1, color: l.color });
          }
        }

        requestAnimationFrame(animate);
      }

      simulation.on("tick", function () {});
      simulation.restart();
      renderPixiFromD3();
      animate();

      return function () {
        stopAnimation = true;
        if (fitTimeout) clearTimeout(fitTimeout);
        if (zoomInHandler) opts.zoomInButton.removeEventListener("click", zoomInHandler);
        if (zoomOutHandler) opts.zoomOutButton.removeEventListener("click", zoomOutHandler);
        simulation.stop();
        try {
          app.destroy(true);
        } catch (_) {
          // PixiJS may throw if WebGL context was already lost.
        }
      };
    }

    var localCleanups = [];
    var currentRenderGeneration = 0;

    function cleanupLocal() {
      for (var i = 0; i < localCleanups.length; i++) {
        localCleanups[i]();
      }
      localCleanups = [];
    }

    // ---- Graph modal controller ----
    // Drives both the global graph modal and the (opt-in) zoomable local graph modal. The +/-
    // depth controls and the X close button are wired only when those elements are present in the
    // DOM (the component renders them based on GraphOptions). The sidebar graph is separate
    // (renderLocal) and never gets these controls.
    var MODAL_MIN_DEPTH = 1;
    var MODAL_DEFAULT_MAX_DEPTH = 5;

    function makeModalState(outerSelector, graphContainerSelector, iconSelector, isLocal) {
      return {
        outerSelector: outerSelector,
        graphContainerSelector: graphContainerSelector,
        iconSelector: iconSelector,
        isLocal: isLocal,
        outers: [],
        icons: [],
        cleanups: [],
        depth: null,
        baseDepth: null,
        maxDepth: MODAL_DEFAULT_MAX_DEPTH,
        allowAllAfterMax: false,
        hasDepthControls: false,
        savedTransform: null,
        iconClickHandler: null,
        decreaseHandler: null,
        increaseHandler: null,
      };
    }

    var globalModal = makeModalState(
      ".global-graph-outer",
      ".global-graph-container",
      ".global-graph-icon",
      false,
    );
    var localModal = makeModalState(
      ".local-graph-outer",
      ".local-graph-container",
      ".local-graph-icon",
      true,
    );
    var modals = [globalModal, localModal];

    var documentClickHandler = null;
    var documentKeydownHandler = null;
    var modalCloseHandler = null;

    function cleanupModal(modal) {
      for (var i = 0; i < modal.cleanups.length; i++) {
        modal.cleanups[i]();
      }
      modal.cleanups = [];
    }

    function anyModalGraphActive(modal) {
      for (var i = 0; i < modal.outers.length; i++) {
        if (modal.outers[i].classList.contains("active")) {
          return true;
        }
      }
      return false;
    }

    // -1 = "All" (whole vault). Reachable when the modal's configured depth is < 0 (the global
    // graph always is) or when it opts in via depthControlAllowAllAfterMax (the local graph).
    function canReachAllDepth(modal) {
      return (modal.baseDepth != null && modal.baseDepth < 0) || modal.allowAllAfterMax;
    }

    function nextDepth(modal, current, delta) {
      if (current === -1) {
        // From "All": only stepping down does anything.
        return delta < 0 ? modal.maxDepth : -1;
      }
      var next = current + delta;
      if (next < MODAL_MIN_DEPTH) return MODAL_MIN_DEPTH;
      if (next > modal.maxDepth) return canReachAllDepth(modal) ? -1 : modal.maxDepth;
      return next;
    }

    function updateDepthControls(modal) {
      for (var i = 0; i < modal.outers.length; i++) {
        var outer = modal.outers[i];
        var label = outer.querySelector(".graph-depth-label");
        if (label) label.textContent = modal.depth === -1 ? "All" : String(modal.depth);
        var decreaseButton = outer.querySelector(".graph-depth-decrease");
        var increaseButton = outer.querySelector(".graph-depth-increase");
        if (decreaseButton)
          decreaseButton.disabled = modal.depth !== -1 && modal.depth <= MODAL_MIN_DEPTH;
        if (increaseButton)
          increaseButton.disabled =
            modal.depth === -1 || (!canReachAllDepth(modal) && modal.depth >= modal.maxDepth);
      }
    }

    function renderModalGraph(modal) {
      cleanupModal(modal);
      var currentSlug = getSlugFromUrl();
      for (var i = 0; i < modal.outers.length; i++) {
        var graphContainer = modal.outers[i].querySelector(modal.graphContainerSelector);
        if (!graphContainer) continue;

        // Cache the configured base config as data-cfg-base, then re-apply the current depth
        // (when depth controls are active) before each render.
        var baseConfig = JSON.parse(
          graphContainer.dataset["cfgBase"] || graphContainer.dataset["cfg"] || "{}",
        );
        if (!graphContainer.dataset["cfgBase"]) {
          graphContainer.dataset["cfgBase"] = JSON.stringify(baseConfig);
        }
        if (modal.depth != null) {
          baseConfig.depth = modal.depth;
        }
        graphContainer.dataset["cfg"] = JSON.stringify(baseConfig);

        var renderOptions = {};
        if (modal.isLocal) {
          // Local graph modal: fit-to-view on open, preserving the zoom across depth changes.
          // (The current-node highlight is driven by the container's data-cfg, not these options.)
          var fitOnOpen = modal.savedTransform == null;
          renderOptions.fitView = fitOnOpen;
          renderOptions.fitFill = 0.5;
          renderOptions.initialTransform = fitOnOpen ? null : modal.savedTransform;
          renderOptions.onTransform = function (transform) {
            modal.savedTransform = transform;
          };
        }

        // Zoom controls (when rendered for this modal) — bound to d3's zoom inside renderGraph.
        renderOptions.zoomInButton = modal.outers[i].querySelector(".graph-zoom-in");
        renderOptions.zoomOutButton = modal.outers[i].querySelector(".graph-zoom-out");

        (function (container, options) {
          renderGraph(container, currentSlug, undefined, options)
            .then(function (cleanup) {
              modal.cleanups.push(cleanup);
            })
            .catch(function (err) {
              console.error("[Graph] Modal render error:", err);
            });
        })(graphContainer, renderOptions);
      }
    }

    function showModalGraph(modal) {
      cleanupModal(modal);
      if (modal.isLocal) {
        // Fresh open: fit-to-view rather than restoring a previous zoom.
        modal.savedTransform = null;
      }
      for (var i = 0; i < modal.outers.length; i++) {
        modal.outers[i].classList.add("active");
        var sidebar = modal.outers[i].closest(".sidebar");
        if (sidebar) {
          sidebar.style.zIndex = "1";
        }
      }
      if (modal.hasDepthControls) updateDepthControls(modal);
      renderModalGraph(modal);
    }

    function hideModalGraph(modal) {
      cleanupModal(modal);
      for (var i = 0; i < modal.outers.length; i++) {
        modal.outers[i].classList.remove("active");
        var sidebar = modal.outers[i].closest(".sidebar");
        if (sidebar) {
          sidebar.style.zIndex = "";
        }
      }
    }

    function toggleModalGraph(modal) {
      if (anyModalGraphActive(modal)) {
        hideModalGraph(modal);
      } else {
        showModalGraph(modal);
      }
    }

    function changeDepth(modal, delta) {
      var next = nextDepth(modal, modal.depth, delta);
      if (next === modal.depth) return;
      modal.depth = next;
      updateDepthControls(modal);
      renderModalGraph(modal);
    }

    // Gathers a modal's elements and (re)binds its icon + depth controls. Called on every nav.
    function setupModalGraph(modal) {
      modal.outers = Array.from(document.querySelectorAll(modal.outerSelector));

      // Seed the configured starting depth and depthControl options from the container's data-cfg.
      modal.baseDepth = null;
      modal.maxDepth = MODAL_DEFAULT_MAX_DEPTH;
      modal.allowAllAfterMax = false;
      for (var i = 0; i < modal.outers.length; i++) {
        var graphContainer = modal.outers[i].querySelector(modal.graphContainerSelector);
        if (!graphContainer) continue;
        var baseConfig = JSON.parse(
          graphContainer.dataset["cfgBase"] || graphContainer.dataset["cfg"] || "{}",
        );
        if (!graphContainer.dataset["cfgBase"]) {
          graphContainer.dataset["cfgBase"] = JSON.stringify(baseConfig);
        }
        if (typeof baseConfig.depth === "number") {
          modal.baseDepth = baseConfig.depth;
        }
        if (typeof baseConfig.depthControlMaxDepth === "number") {
          modal.maxDepth = baseConfig.depthControlMaxDepth;
        }
        modal.allowAllAfterMax = !!baseConfig.depthControlAllowAllAfterMax;
        break;
      }

      // Depth controls are active only if the component rendered them for this modal.
      var depthControls = modal.outers.length
        ? modal.outers[0].querySelector(".graph-depth-controls")
        : null;
      modal.hasDepthControls = !!depthControls;
      // Reset the depth on every navigation. null when depth controls are off (renderGraph then
      // uses the configured depth as-is).
      modal.depth = modal.hasDepthControls && modal.baseDepth != null ? modal.baseDepth : null;

      if (modal.isLocal) {
        modal.savedTransform = null;
        // Close the local graph modal on navigation (reset behavior).
        for (var i = 0; i < modal.outers.length; i++) {
          modal.outers[i].classList.remove("active");
          var sidebar = modal.outers[i].closest(".sidebar");
          if (sidebar) sidebar.style.zIndex = "";
        }
      }

      // Icon → toggle.
      if (modal.iconClickHandler) {
        for (var i = 0; i < modal.icons.length; i++) {
          modal.icons[i].removeEventListener("click", modal.iconClickHandler);
        }
      }
      modal.icons = Array.from(document.querySelectorAll(modal.iconSelector));
      modal.iconClickHandler = function () {
        toggleModalGraph(modal);
      };
      for (var i = 0; i < modal.icons.length; i++) {
        modal.icons[i].addEventListener("click", modal.iconClickHandler);
      }

      // Depth +/- buttons, scoped to this modal.
      var decreaseButtons = document.querySelectorAll(
        modal.outerSelector + " .graph-depth-decrease",
      );
      if (modal.decreaseHandler) {
        for (var i = 0; i < decreaseButtons.length; i++) {
          decreaseButtons[i].removeEventListener("click", modal.decreaseHandler);
        }
      }
      modal.decreaseHandler = function (e) {
        e.stopPropagation();
        changeDepth(modal, -1);
      };
      for (var i = 0; i < decreaseButtons.length; i++) {
        decreaseButtons[i].addEventListener("click", modal.decreaseHandler);
      }

      var increaseButtons = document.querySelectorAll(
        modal.outerSelector + " .graph-depth-increase",
      );
      if (modal.increaseHandler) {
        for (var i = 0; i < increaseButtons.length; i++) {
          increaseButtons[i].removeEventListener("click", modal.increaseHandler);
        }
      }
      modal.increaseHandler = function (e) {
        e.stopPropagation();
        changeDepth(modal, 1);
      };
      for (var i = 0; i < increaseButtons.length; i++) {
        increaseButtons[i].addEventListener("click", modal.increaseHandler);
      }

      if (modal.hasDepthControls) updateDepthControls(modal);
    }

    function renderLocal() {
      cleanupLocal();
      var thisGeneration = ++currentRenderGeneration;
      var slug = getSlugFromUrl();
      addToVisited(slug);

      var localContainers = document.querySelectorAll(".graph-container");
      for (var i = 0; i < localContainers.length; i++) {
        (function (container) {
          renderGraph(container, slug, thisGeneration)
            .then(function (cleanup) {
              if (thisGeneration === currentRenderGeneration) {
                localCleanups.push(cleanup);
              }
            })
            .catch(function (err) {
              console.error("[Graph] Local render error:", err);
            });
        })(localContainers[i]);
      }
    }

    function handleNav(e) {
      var slug = e.detail ? e.detail.url : getSlugFromUrl();
      addToVisited(simplifySlug(slug));

      renderLocal();

      for (var i = 0; i < modals.length; i++) {
        setupModalGraph(modals[i]);
      }

      // Click outside a graph modal's box / icon / controls closes it.
      if (documentClickHandler) {
        document.removeEventListener("click", documentClickHandler);
      }
      documentClickHandler = function (e) {
        for (var i = 0; i < modals.length; i++) {
          var modal = modals[i];
          if (!anyModalGraphActive(modal)) continue;
          var inContainer = e.target.closest(modal.graphContainerSelector);
          var inIcon = e.target.closest(modal.iconSelector);
          var inControls =
            e.target.closest(".graph-depth-controls") || e.target.closest(".graph-zoom-controls");
          if (!inContainer && !inIcon && !inControls) {
            hideModalGraph(modal);
          }
        }
      };
      document.addEventListener("click", documentClickHandler);

      // Escape closes any open graph modal; Ctrl/Cmd+G toggles the global graph.
      if (documentKeydownHandler) {
        document.removeEventListener("keydown", documentKeydownHandler);
      }
      documentKeydownHandler = function (e) {
        if (e.key === "Escape") {
          for (var i = 0; i < modals.length; i++) {
            if (anyModalGraphActive(modals[i])) hideModalGraph(modals[i]);
          }
          return;
        }
        if (e.key === "g" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
          e.preventDefault();
          toggleModalGraph(globalModal);
        }
      };
      document.addEventListener("keydown", documentKeydownHandler);

      // X close buttons — close whichever graph modal contains them.
      if (modalCloseHandler) {
        var previousCloseButtons = document.querySelectorAll(".modal-close");
        for (var i = 0; i < previousCloseButtons.length; i++) {
          previousCloseButtons[i].removeEventListener("click", modalCloseHandler);
        }
      }
      modalCloseHandler = function (e) {
        e.stopPropagation();
        var closeButton = e.currentTarget;
        for (var i = 0; i < modals.length; i++) {
          if (closeButton.closest(modals[i].outerSelector)) {
            hideModalGraph(modals[i]);
            return;
          }
        }
      };
      var closeButtons = document.querySelectorAll(".modal-close");
      for (var i = 0; i < closeButtons.length; i++) {
        closeButtons[i].addEventListener("click", modalCloseHandler);
      }

      // The global graph modal can persist across SPA navigation; re-render it if still open.
      if (anyModalGraphActive(globalModal)) {
        showModalGraph(globalModal);
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        handleNav({ detail: { url: getSlugFromUrl() } });
      });
    } else {
      handleNav({ detail: { url: getSlugFromUrl() } });
    }
    document.addEventListener("prenav", function () {
      cleanupLocal();
      cleanupModal(globalModal);
      cleanupModal(localModal);
    });
    document.addEventListener("nav", handleNav);
    document.addEventListener("render", handleNav);

    function handleThemeChange() {
      renderLocal();
      for (var i = 0; i < modals.length; i++) {
        if (anyModalGraphActive(modals[i])) {
          renderModalGraph(modals[i]);
        }
      }
    }
    document.addEventListener("themechange", handleThemeChange);
  }
})();
