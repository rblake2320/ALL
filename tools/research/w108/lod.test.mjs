import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {SimplifyModifier} from 'three/addons/modifiers/SimplifyModifier.js';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {createLod} from './lod.mjs';
function fixture(){
 const group=new THREE.Group();
 group.add(new THREE.Mesh(new RoundedBoxGeometry(.8,1.4,.8,1,.05),new THREE.MeshStandardMaterial()));
 group.add(new THREE.Mesh(new THREE.SphereGeometry(.1,24,16),new THREE.MeshStandardMaterial()));
 return group;
}
test('reproduces old LOD erasure, then preserves the same rounded-box mesh',()=>{
 const source=fixture(),geometry=source.children[0].geometry;
 const broken=new SimplifyModifier().modify(geometry,Math.floor(geometry.attributes.position.count*.3));
 assert.equal(broken.attributes.position.count,0,'retained old algorithm must reproduce the body-erasure regression');
 const fixed=createLod(source,new SimplifyModifier(),mergeVertices);
 assert.equal(fixed.asset.children.length,source.children.length);
 assert(fixed.asset.children.every(n=>n.geometry.attributes.position.count>0));
});
test('accepted simplifications retain bounds and introduce no boundary/non-manifold edges',()=>{
 const result=createLod(fixture(),new SimplifyModifier(),mergeVertices);
 const changed=result.audit.filter(r=>r.changed);assert(changed.length>0);
 for(const row of changed){assert(row.boundsRetained);assert(row.topologyRetained);assert(row.candidateBoundary.open<=row.originalBoundary.open);assert(row.candidateBoundary.nonManifold<=row.originalBoundary.nonManifold);}
});
test('source vertex data remains unchanged',()=>{
 const source=fixture(),before=source.children.map(n=>Array.from(n.geometry.attributes.position.array));
 createLod(source,new SimplifyModifier(),mergeVertices);
 assert.deepEqual(source.children.map(n=>Array.from(n.geometry.attributes.position.array)),before);
});
test('textured meshes keep their UV geometry rather than using the colour-only simplification',()=>{
 const source=fixture();source.children[0].material.map=new THREE.Texture();
 const result=createLod(source,new SimplifyModifier(),mergeVertices);
 assert.equal(result.asset.children[0].geometry,source.children[0].geometry);
 assert.equal(result.audit[0].changed,false);
});
