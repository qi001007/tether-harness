(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,552158,t=>{t.v(e=>Promise.all(["static/chunks/28l9id1nj3116.js"].map(e=>t.l(e))).then(()=>e(175545)))},649224,t=>{t.v(e=>Promise.all(["static/chunks/1zagch2u6wnz4.js"].map(e=>t.l(e))).then(()=>e(311232)))},939673,t=>{t.v(e=>Promise.all(["static/chunks/1b1k_j5ghmu_r.js"].map(e=>t.l(e))).then(()=>e(664375)))},526485,t=>{t.v(e=>Promise.all(["static/chunks/3ig7cohoab5zp.js"].map(e=>t.l(e))).then(()=>e(978478)))},469279,t=>{t.v(e=>Promise.all(["static/chunks/1hexxctijowuu.js"].map(e=>t.l(e))).then(()=>e(268237)))},962275,t=>{t.v(e=>Promise.all(["static/chunks/0ykvptmr10ed9.js"].map(e=>t.l(e))).then(()=>e(151769)))},974922,t=>{t.v(e=>Promise.all(["static/chunks/0ygizmb8z-7h4.js"].map(e=>t.l(e))).then(()=>e(150908)))},863450,t=>{t.v(e=>Promise.all(["static/chunks/0_j1z4v3979em.js"].map(e=>t.l(e))).then(()=>e(754577)))},293114,t=>{t.v(e=>Promise.all(["static/chunks/3pz2egb6kifjo.js"].map(e=>t.l(e))).then(()=>e(206944)))},905608,t=>{t.v(e=>Promise.all(["static/chunks/15c2m239222_x.js"].map(e=>t.l(e))).then(()=>e(642564)))},398593,t=>{t.v(e=>Promise.all(["static/chunks/10t63-aynrlql.js"].map(e=>t.l(e))).then(()=>e(198312)))},563269,t=>{t.v(e=>Promise.all(["static/chunks/3ffc_oiqjmx5u.js"].map(e=>t.l(e))).then(()=>e(164709)))},398449,t=>{t.v(e=>Promise.all(["static/chunks/2gpx123wpum1b.js"].map(e=>t.l(e))).then(()=>e(439077)))},682312,t=>{t.v(e=>Promise.all(["static/chunks/1nef2vw-9p1kc.js"].map(e=>t.l(e))).then(()=>e(407721)))},660716,t=>{t.v(e=>Promise.all(["static/chunks/2wv6e1j8ll27j.js"].map(e=>t.l(e))).then(()=>e(592379)))},537834,t=>{"use strict";var e=t.i(173474),a=t.i(696017),i=t.i(447804),l=t.i(60231),s=t.i(508324),r=t.i(419524),n=t.i(289590),o=t.i(787198),c=t.i(291342),p=l.f.pie,h={sections:new Map,showData:!1,config:p},d=h.sections,m=h.showData,u=structuredClone(p),g=(0,r.p)(()=>structuredClone(u),"getConfig"),f=(0,r.p)(()=>{d=new Map,m=h.showData,(0,l.M)()},"clear"),v=(0,r.p)(({label:t,value:e})=>{if(e<0)throw Error(`"${t}" has invalid value: ${e}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);d.has(t)||(d.set(t,e),s.d.debug(`added new section: ${t}, with value: ${e}`))},"addSection"),k=(0,r.p)(()=>d,"getSections"),x=(0,r.p)(t=>{m=t},"setShowData"),w=(0,r.p)(()=>m,"getShowData"),y={getConfig:g,clear:f,setDiagramTitle:l.a,getDiagramTitle:l.F,setAccTitle:l.b,getAccTitle:l.d,setAccDescription:l.C,getAccDescription:l.j,addSection:v,getSections:k,setShowData:x,getShowData:w},$=(0,r.p)((t,a)=>{(0,e.f)(t,a),a.setShowData(t.showData),t.sections.map(a.addSection)},"populateDb"),b={parse:(0,r.p)(async t=>{let e=await (0,n.x)("pie",t);s.d.debug(e),$(e,y)},"parse")},j=(0,r.p)(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${t.pieOuterStrokeColor};
    stroke-width: ${t.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${t.pieTitleTextSize};
    fill: ${t.pieTitleTextColor};
    font-family: ${t.fontFamily};
  }
  .slice {
    font-family: ${t.fontFamily};
    fill: ${t.pieSectionTextColor};
    font-size:${t.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${t.pieLegendTextColor};
    font-family: ${t.fontFamily};
    font-size: ${t.pieLegendTextSize};
  }
`,"getStyles"),S=(0,r.p)(t=>{let e=[...t.values()].reduce((t,e)=>t+e,0),a=[...t.entries()].map(([t,e])=>({label:t,value:e})).filter(t=>t.value/e*100>=1);return(0,o.Q)().value(t=>t.value).sort(null)(a)},"createPieArcs"),C=(0,r.p)((t,e,r,n)=>{s.d.debug("rendering pie chart\n"+t);let p=n.db,h=(0,l.z)(),d=(0,i.z)(p.getConfig(),h.pie),m=(0,a.f)(e),u=m.append("g");u.attr("transform","translate(225,225)");let{themeVariables:g}=h,[f]=(0,i.X)(g.pieOuterStrokeWidth);f??=2;let v=d.legendPosition,k=d.textPosition,x=d.donutHole>0&&d.donutHole<=.9?d.donutHole:0,w=(0,o.y)().innerRadius(185*x).outerRadius(185),y=(0,o.y)().innerRadius(185*k).outerRadius(185*k),$=u.append("g");$.append("circle").attr("cx",0).attr("cy",0).attr("r",185+f/2).attr("class","pieOuterCircle");let b=p.getSections(),j=S(b),C=[g.pie1,g.pie2,g.pie3,g.pie4,g.pie5,g.pie6,g.pie7,g.pie8,g.pie9,g.pie10,g.pie11,g.pie12],T=0;b.forEach(t=>{T+=t});let P=j.filter(t=>"0"!==(t.data.value/T*100).toFixed(0)),z=(0,c.scaleOrdinal)(C).domain([...b.keys()]);$.selectAll("mySlices").data(P).enter().append("path").attr("d",w).attr("fill",t=>z(t.data.label)).attr("class",t=>{let e="pieCircle";return"hover"===d.highlightSlice?e+=" highlightedOnHover":d.highlightSlice===t.data.label&&(e+=" highlighted"),e}),$.selectAll("mySlices").data(P).enter().append("text").text(t=>(t.data.value/T*100).toFixed(0)+"%").attr("transform",t=>"translate("+y.centroid(t)+")").style("text-anchor","middle").attr("class","slice");let D=u.append("text").text(p.getDiagramTitle()).attr("x",0).attr("y",-200).attr("class","pieTitleText"),A=[...b.entries()].map(([t,e])=>({label:t,value:e})),O=u.selectAll(".legend").data(A).enter().append("g").attr("class","legend");O.append("rect").attr("width",18).attr("height",18).style("fill",t=>z(t.label)).style("stroke",t=>z(t.label)),O.append("text").attr("x",22).attr("y",14).text(t=>p.getShowData()?`${t.label} [${t.value}]`:t.label);let R=Math.max(...O.selectAll("text").nodes().map(t=>t?.getBoundingClientRect().width??0)),M=450,F=490,B=22*A.length;switch(v){case"center":O.attr("transform",(t,e)=>"translate("+(-R/2-22)+","+(22*e-22*A.length/2)+")");break;case"top":M+=B,O.attr("transform",(t,e)=>`translate(${-R/2-22}, ${22*e-185})`),$.attr("transform",()=>`translate(0, ${B+22})`);break;case"bottom":M+=B,O.attr("transform",(t,e)=>"translate("+(-R/2-22)+","+(22*e- -207)+")");break;case"left":F+=22+R,O.attr("transform",(t,e)=>"translate(-207,"+(22*e-22*A.length/2)+")"),$.attr("transform",()=>`translate(${R+18+4}, 0)`);break;default:F+=22+R,O.attr("transform",(t,e)=>"translate(216,"+(22*e-22*A.length/2)+")")}let H=D.node()?.getBoundingClientRect().width??0,_=Math.min(0,225-H/2),W=Math.max(F,225+H/2)-_;m.attr("viewBox",`${_} 0 ${W} ${M}`),(0,l.m)(m,M,W,d.useMaxWidth)},"draw");t.s(["diagram",0,{parser:b,db:y,renderer:{draw:C},styles:j}])}]);