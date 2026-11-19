// SimplifyModifier merges duplicate vertices before removal. Budget against that
// merged count, and retain the original mesh if simplification damages its bounds.
export function createLod(source, modifier, mergeVertices) {
  const asset = source.clone(true);
  const audit = [];
  asset.traverse(node => {
    if (!node.isMesh) return;
    const original = node.geometry;
    const row = {name: node.name, originalTriangles: triangles(original), changed: false};
    audit.push(row);
    if (original.attributes.position.count < 96 || Array.isArray(node.material)) return;
    // These trial assets use material colours, not textures. Weld position seams
    // before collapse; preserving split UV/normal vertices can open visible holes.
    if (['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'].some(key=>node.material[key]) || original.attributes.skinIndex) return;
    const prepared=original.clone();
    for(const name of ['normal','uv','tangent'])prepared.deleteAttribute(name);
    const merged = mergeVertices(prepared);
    row.mergedVertices = merged.attributes.position.count;
    row.removalBudget = Math.floor(row.mergedVertices * 0.15);
    if (row.removalBudget < 1) return;
    const candidate = modifier.modify(merged, row.removalBudget);
    candidate.computeVertexNormals();
    original.computeBoundingBox();
    candidate.computeBoundingBox();
    row.candidateTriangles = triangles(candidate);
    row.boundsRetained = withinBounds(original.boundingBox, candidate.boundingBox);
    row.nonemptyFinite = validPositions(candidate) && row.candidateTriangles > 0;
    row.originalBoundary=boundaryEdges(original);
    row.candidateBoundary=boundaryEdges(candidate);
    row.topologyRetained=row.candidateBoundary.open<=row.originalBoundary.open && row.candidateBoundary.nonManifold<=row.originalBoundary.nonManifold;
    if (row.nonemptyFinite && row.boundsRetained && row.topologyRetained && row.candidateTriangles < row.originalTriangles) {
      node.geometry = candidate;
      row.changed = true;
    }
  });
  return {asset, audit};
}

function boundaryEdges(geometry) {
  const p=geometry.attributes.position,index=geometry.index;
  const point=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(n=>Math.round(n*1e6)).join(',');
  const edges=new Map(),count=index?index.count:p.count;
  for(let i=0;i<count;i+=3){
    const ids=[0,1,2].map(j=>point(index?index.getX(i+j):i+j));
    if(new Set(ids).size!==3)continue;
    for(let j=0;j<3;j++){const pair=[ids[j],ids[(j+1)%3]].sort().join('|');edges.set(pair,(edges.get(pair)||0)+1);}
  }
  return {open:[...edges.values()].filter(n=>n===1).length,nonManifold:[...edges.values()].filter(n=>n>2).length};
}

function triangles(geometry) {
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}
function validPositions(geometry) {
  const p = geometry.attributes.position;
  if (!p || !p.count) return false;
  for (let i = 0; i < p.count; i++) {
    if (![p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)) return false;
  }
  return true;
}
function withinBounds(before, after) {
  if (!before || !after || after.isEmpty()) return false;
  for (let i = 0; i < 3; i++) {
    const tolerance = Math.max(0.001, (before.max.getComponent(i) - before.min.getComponent(i)) * 0.02);
    if (Math.abs(before.min.getComponent(i) - after.min.getComponent(i)) > tolerance ||
        Math.abs(before.max.getComponent(i) - after.max.getComponent(i)) > tolerance) return false;
  }
  return true;
}
