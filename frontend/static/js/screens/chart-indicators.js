/**
 * AXIOM v2 - Chart Indicators
 * LWC v5.2
 */

const IndicatorRegistry = {
  definitions: {
    SMA: {
      name:'SMA', label:'Media Movil Simple', pane:'main',
      defaults:{period:20, color:'#2563EB', lineWidth:1.5},
      fields:[
        {key:'period',    label:'Periodo', type:'number', min:2,   max:500},
        {key:'color',     label:'Color',   type:'color'},
        {key:'lineWidth', label:'Grosor',  type:'number', min:1,   max:4, step:0.5},
      ],
      summary: function(p){ return 'SMA ' + p.period; },
      calc: function(candles, p) {
        var cl=candles.map(function(c){return c.close;}), out=[];
        for(var i=p.period-1;i<cl.length;i++){
          var sum=0; for(var j=i-p.period+1;j<=i;j++) sum+=cl[j];
          out.push({time:candles[i].time, value:sum/p.period});
        }
        return [{data:out, color:p.color, lineWidth:p.lineWidth||1.5, type:'line'}];
      },
    },
    EMA: {
      name:'EMA', label:'Media Movil Exponencial', pane:'main',
      defaults:{period:20, color:'#B47514', lineWidth:1.5},
      fields:[
        {key:'period',    label:'Periodo', type:'number', min:2, max:500},
        {key:'color',     label:'Color',   type:'color'},
        {key:'lineWidth', label:'Grosor',  type:'number', min:1, max:4, step:0.5},
      ],
      summary: function(p){ return 'EMA ' + p.period; },
      calc: function(candles, p) {
        var cl=candles.map(function(c){return c.close;});
        var k=2/(p.period+1), ema=0, i;
        for(i=0;i<p.period;i++) ema+=cl[i]; ema/=p.period;
        var out=[{time:candles[p.period-1].time, value:ema}];
        for(i=p.period;i<cl.length;i++){
          ema=cl[i]*k+ema*(1-k);
          out.push({time:candles[i].time, value:ema});
        }
        return [{data:out, color:p.color, lineWidth:p.lineWidth||1.5, type:'line'}];
      },
    },
    BB: {
      name:'BB', label:'Bandas de Bollinger', pane:'main',
      defaults:{period:20, stddev:2, colorMid:'#78716C', colorBand:'#2563EB', lineWidth:1},
      fields:[
        {key:'period',    label:'Periodo',        type:'number', min:2,   max:500},
        {key:'stddev',    label:'Desv. estandar', type:'number', min:0.5, max:5, step:0.5},
        {key:'colorMid',  label:'Color media',    type:'color'},
        {key:'colorBand', label:'Color bandas',   type:'color'},
        {key:'lineWidth', label:'Grosor',         type:'number', min:1,   max:4, step:0.5},
      ],
      summary: function(p){ return 'BB ' + p.period + ' (' + p.stddev + ')'; },
      calc: function(candles, p) {
        var cl=candles.map(function(c){return c.close;}), mid=[], up=[], dn=[], i;
        for(i=p.period-1;i<cl.length;i++){
          var sl=cl.slice(i-p.period+1,i+1);
          var mean=sl.reduce(function(a,b){return a+b;},0)/p.period;
          var sd=Math.sqrt(sl.reduce(function(a,b){return a+Math.pow(b-mean,2);},0)/p.period);
          mid.push({time:candles[i].time, value:mean});
          up.push({time:candles[i].time,  value:mean+p.stddev*sd});
          dn.push({time:candles[i].time,  value:mean-p.stddev*sd});
        }
        return [
          {data:mid, color:p.colorMid,  lineWidth:p.lineWidth||1, lineStyle:2, type:'line'},
          {data:up,  color:p.colorBand, lineWidth:p.lineWidth||1, type:'line'},
          {data:dn,  color:p.colorBand, lineWidth:p.lineWidth||1, type:'line'},
        ];
      },
    },
    RSI: {
      name:'RSI', label:'RSI', pane:'separate',
      defaults:{period:14, color:'#B47514', levelOB:70, levelOS:30},
      fields:[
        {key:'period',  label:'Periodo',     type:'number', min:2,  max:100},
        {key:'color',   label:'Color',       type:'color'},
        {key:'levelOB', label:'Sobrecompra', type:'number', min:50, max:95},
        {key:'levelOS', label:'Sobreventa',  type:'number', min:5,  max:50},
      ],
      summary: function(p){ return 'RSI ' + p.period; },
      calc: function(candles, p) {
        var cl=candles.map(function(c){return c.close;}), ch=[], i;
        for(i=1;i<cl.length;i++) ch.push(cl[i]-cl[i-1]);
        if(ch.length<p.period) return [{data:[], color:p.color, type:'line'}];
        var gAvg=0, lAvg=0;
        for(i=0;i<p.period;i++){
          if(ch[i]>0) gAvg+=ch[i]; else lAvg+=Math.abs(ch[i]);
        }
        gAvg/=p.period; lAvg/=p.period;
        var rsi=[];
        rsi.push({time:candles[p.period].time, value:lAvg===0?100:100-(100/(1+gAvg/lAvg))});
        for(i=p.period;i<ch.length;i++){
          gAvg=(gAvg*(p.period-1)+Math.max(ch[i],0))/p.period;
          lAvg=(lAvg*(p.period-1)+Math.abs(Math.min(ch[i],0)))/p.period;
          rsi.push({time:candles[i+1].time, value:lAvg===0?100:100-(100/(1+gAvg/lAvg))});
        }
        var ob=rsi.map(function(r){return {time:r.time,value:p.levelOB};});
        var os=rsi.map(function(r){return {time:r.time,value:p.levelOS};});
        var md=rsi.map(function(r){return {time:r.time,value:50};});
        return [
          {data:rsi, color:p.color,     lineWidth:1.5, type:'line'},
          {data:ob,  color:'#D93B3B60', lineWidth:1, lineStyle:2, type:'line'},
          {data:os,  color:'#56A14F60', lineWidth:1, lineStyle:2, type:'line'},
          {data:md,  color:'#2C292680', lineWidth:1, lineStyle:2, type:'line'},
        ];
      },
    },
    MACD: {
      name:'MACD', label:'MACD', pane:'separate',
      defaults:{fast:12, slow:26, signal:9, colorMACD:'#2563EB', colorSignal:'#D86326', colorHist:'#56A14F'},
      fields:[
        {key:'fast',        label:'EMA rapida',  type:'number', min:2,  max:50},
        {key:'slow',        label:'EMA lenta',   type:'number', min:5,  max:200},
        {key:'signal',      label:'Senal',       type:'number', min:2,  max:50},
        {key:'colorMACD',   label:'Color MACD',  type:'color'},
        {key:'colorSignal', label:'Color senal', type:'color'},
        {key:'colorHist',   label:'Color hist.', type:'color'},
      ],
      summary: function(p){ return 'MACD (' + p.fast + ',' + p.slow + ',' + p.signal + ')'; },
      calc: function(candles, p) {
        var cl=candles.map(function(c){return c.close;}), i;
        function emaArr(data, per) {
          if(data.length<per) return [];
          var k=2/(per+1), e=0, j;
          for(j=0;j<per;j++) e+=data[j]; e/=per;
          var r=[{i:per-1, v:e}];
          for(j=per;j<data.length;j++){e=data[j]*k+e*(1-k); r.push({i:j,v:e});}
          return r;
        }
        var fastE=emaArr(cl,p.fast), slowE=emaArr(cl,p.slow);
        var slowM={}; slowE.forEach(function(e){slowM[e.i]=e.v;});
        var macdArr=fastE.filter(function(f){return slowM[f.i]!==undefined;})
          .map(function(f){return {i:f.i, v:f.v-slowM[f.i], time:candles[f.i].time};});
        if(macdArr.length<p.signal) return [
          {data:[], color:p.colorMACD,   lineWidth:1.5, type:'line'},
          {data:[], color:p.colorSignal, lineWidth:1.5, type:'line'},
          {data:[], color:p.colorHist,   type:'histogram'},
        ];
        var mVals=macdArr.map(function(m){return m.v;});
        var k2=2/(p.signal+1), se=0;
        for(i=0;i<p.signal;i++) se+=mVals[i]; se/=p.signal;
        var sigArr=[{i:macdArr[p.signal-1].i, v:se, time:macdArr[p.signal-1].time}];
        for(i=p.signal;i<macdArr.length;i++){
          se=mVals[i]*k2+se*(1-k2);
          sigArr.push({i:macdArr[i].i, v:se, time:macdArr[i].time});
        }
        var sigM={}; sigArr.forEach(function(s){sigM[s.i]=s.v;});
        var hist=macdArr.filter(function(m){return sigM[m.i]!==undefined;})
          .map(function(m){
            var hv=m.v-sigM[m.i];
            return {time:m.time, value:hv, color:hv>=0?p.colorHist+'CC':'#D93B3BCC'};
          });
        return [
          {data:macdArr.map(function(m){return {time:m.time,value:m.v};}), color:p.colorMACD,   lineWidth:1.5, type:'line'},
          {data:sigArr.map(function(s){return {time:s.time,value:s.v};}),  color:p.colorSignal, lineWidth:1.5, type:'line'},
          {data:hist, color:p.colorHist, type:'histogram'},
        ];
      },
    },
    PSAR: {
      name:'PSAR', label:'Parabolic SAR', pane:'main',
      defaults:{step:0.02, max:0.2, colorBull:'#56A14F', colorBear:'#D93B3B'},
      fields:[
        {key:'step',      label:'Paso AF',      type:'number', min:0.001, max:0.1,  step:0.001},
        {key:'max',       label:'Max AF',       type:'number', min:0.1,   max:0.5,  step:0.01},
        {key:'colorBull', label:'Color alcista',type:'color'},
        {key:'colorBear', label:'Color bajista',type:'color'},
      ],
      summary: function(p){ return 'PSAR'; },
      calc: function(candles, p) {
        if(candles.length < 3) return [{data:[], type:'psar'}];
        var n=candles.length, i;
        var highs  = candles.map(function(c){return c.high;});
        var lows   = candles.map(function(c){return c.low;});
        var closes = candles.map(function(c){return c.close;});
        var bullish = closes[1] > closes[0];
        var af = p.step;
        var ep = bullish ? highs[0] : lows[0];
        var sar = bullish ? Math.min(lows[0],lows[1]) : Math.max(highs[0],highs[1]);
        var bull=[], bear=[];
        for(i=2;i<n;i++){
          sar = sar + af*(ep-sar);
          if(bullish){
            sar = Math.min(sar, lows[i-1], i>=2?lows[i-2]:lows[i-1]);
            if(lows[i]<sar){ bullish=false; sar=ep; ep=lows[i]; af=p.step; }
            else {
              if(highs[i]>ep){ ep=highs[i]; af=Math.min(af+p.step,p.max); }
              bull.push({time:candles[i].time, value:sar});
            }
          } else {
            sar = Math.max(sar, highs[i-1], i>=2?highs[i-2]:highs[i-1]);
            if(highs[i]>sar){ bullish=true; sar=ep; ep=highs[i]; af=p.step; }
            else {
              if(lows[i]<ep){ ep=lows[i]; af=Math.min(af+p.step,p.max); }
              bear.push({time:candles[i].time, value:sar});
            }
          }
        }
        return [{data:[], type:'psar', bull:bull, bear:bear,
                 colorBull:p.colorBull, colorBear:p.colorBear}];
      },
    },
    SR: {
      name:'S/R', label:'Soportes y Resistencias', pane:'main',
      defaults:{tolerance:0.015, minTouches:2, colorSupport:'#56A14F80', colorResist:'#D93B3B80', lookback:100},
      fields:[
        {key:'tolerance',    label:'Tolerancia %',     type:'number', min:0.001, max:0.05,  step:0.001},
        {key:'minTouches',   label:'Toques minimos',   type:'number', min:2,     max:10},
        {key:'lookback',     label:'Velas a analizar', type:'number', min:20,    max:500},
        {key:'colorSupport', label:'Color soporte',    type:'color'},
        {key:'colorResist',  label:'Color resistencia',type:'color'},
      ],
      summary: function(p){ return 'S/R'; },
      calc: function(candles, p) {
        var n    = Math.min(candles.length, p.lookback||100);
        var data = candles.slice(candles.length-n);
        if(data.length<10) return [{data:[], type:'sr', supports:[], resistances:[]}];
        var currentPrice = data[data.length-1].close;
        var tol = p.tolerance||0.015;
        var levels = [];
        data.forEach(function(c){
          levels.push(c.high);
          levels.push(c.low);
        });
        levels.sort(function(a,b){return a-b;});
        var zones = [];
        var i=0;
        while(i<levels.length){
          var base=levels[i], group=[base], j=i+1;
          while(j<levels.length && (levels[j]-base)/base<=tol){ group.push(levels[j]); j++; }
          if(group.length>=p.minTouches){
            var avg=group.reduce(function(a,b){return a+b;},0)/group.length;
            zones.push({price:avg, touches:group.length});
          }
          i=j;
        }
        var supports    = zones.filter(function(z){return z.price<=currentPrice;});
        var resistances = zones.filter(function(z){return z.price>currentPrice;});
        supports.sort(function(a,b){return b.price-a.price;});
        resistances.sort(function(a,b){return a.price-b.price;});
        return [{
          data:[], type:'sr',
          supports:    supports.slice(0,5).map(function(z){return {price:z.price, color:p.colorSupport, touches:z.touches};}),
          resistances: resistances.slice(0,5).map(function(z){return {price:z.price, color:p.colorResist, touches:z.touches};}),
        }];
      },
    },
  },
  get: function(type){ return this.definitions[type]; },
  list: function(){
    var self=this;
    return Object.keys(this.definitions).map(function(t){
      return Object.assign({type:t}, self.definitions[t]);
    });
  },
  groups: function(){
    return {
      'Tendencia':   ['SMA','EMA','BB','PSAR'],
      'Osciladores': ['RSI','MACD'],
      'Zonas':       ['SR'],
    };
  },
};


const IndicatorManager = {
  _chart:             null,
  _lwc:               null,
  _candleSeries:      null,
  _candles:           [],
  _active:            [],
  _panes:             [],
  _overlayTimer:      null,
  _mainPaneCollapsed: false,

  init: function(chart, lwc, candleSeries) {
    this._chart             = chart;
    this._lwc               = lwc;
    this._candleSeries      = candleSeries || null;
    this._active            = [];
    this._panes             = [];
    this._overlayTimer      = null;
  },

  setCandles: function(candles) {
    this._candles = candles;
    var self = this;
    this._active.forEach(function(ind){
      if(ind.visible) self._refreshData(ind);
    });
    this._scheduleOverlayRender();
  },

  _scheduleOverlayRender: function() {
    var self = this;
    if(this._overlayTimer) clearTimeout(this._overlayTimer);
    this._overlayTimer = setTimeout(function(){ self._renderOverlays(); }, 200);
  },

  loadFromDB: async function(timeframe) {
    this._clearAll();
    var data = await API.getIndicators().catch(function(){return {indicators:[]};});
    for(var i=0;i<data.indicators.length;i++){
      var row = data.indicators[i];
      if(row.timeframes && row.timeframes.length && row.timeframes.indexOf(timeframe)<0) continue;
      var ind = await this._mountIndicator(row);
      if(ind) this._active.push(ind);
    }
    this._scheduleOverlayRender();
  },

  add: async function(type, params, timeframes) {
    timeframes = timeframes || [];
    var def = IndicatorRegistry.get(type);
    if(!def) return null;
    var fullParams = Object.assign({}, def.defaults, params);
    var res = await API.saveIndicator({
      type:type, params:fullParams, timeframes:timeframes,
      visible:true, position:def.pane==='separate'?'pane':'main', style:{}
    });
    if(!res||!res.id) return null;
    var ind = await this._mountIndicator({
      id:res.id, type:type, params:fullParams, timeframes:timeframes, visible:true
    });
    if(ind){ this._active.push(ind); this._scheduleOverlayRender(); }
    return ind;
  },

  remove: async function(id) {
    var ind = this._active.filter(function(i){return i.id===id;})[0];
    if(!ind) return;
    var pi = ind.paneIndex;
    this._removeSeries(ind);
    this._active = this._active.filter(function(i){return i.id!==id;});
    // Eliminar pane si quedo vacio
    if(pi > 0) {
      var stillUsed = this._active.some(function(o){return o.paneIndex===pi;});
      if(!stillUsed){
        try{
          var panes = this._chart.panes();
          if(panes[pi]) this._chart.removePane(pi);
          this._panes.splice(pi-1, 1);
          this._active.forEach(function(o){ if(o.paneIndex>pi) o.paneIndex--; });
        }catch(e){}
        this._redistributePaneHeights();
      }
    }
    await fetch('/api/charts/indicators/'+id, {method:'DELETE'});
    this._scheduleOverlayRender();
  },

  toggleVisible: async function(id) {
    var ind = this._active.filter(function(i){return i.id===id;})[0];
    if(!ind) return;
    ind.visible = !ind.visible;
    await fetch('/api/charts/indicators/'+id, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({visible:ind.visible})
    });
    if(ind.visible){
      this._createSeries(ind);
      if(this._candles.length) this._refreshData(ind);
    } else {
      this._removeSeries(ind);
    }
    this._scheduleOverlayRender();
  },

  updateParams: async function(id, params) {
    var ind = this._active.filter(function(i){return i.id===id;})[0];
    if(!ind) return;
    ind.params = Object.assign({}, ind.params, params);
    await fetch('/api/charts/indicators/'+id, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({params:ind.params})
    });
    if(ind.visible){
      this._removeSeries(ind);
      this._createSeries(ind);
      if(this._candles.length) this._refreshData(ind);
    }
    this._scheduleOverlayRender();
  },

  _mountIndicator: async function(row) {
    var def = IndicatorRegistry.get(row.type);
    if(!def) return null;
    var params = row.params || {};
    if(typeof params==='string'){ try{params=JSON.parse(params);}catch(e){params={};} }
    params = Object.assign({}, def.defaults, params);
    var ind = {
      id:         row.id,
      type:       row.type,
      params:     params,
      timeframes: row.timeframes || [],
      visible:    row.visible !== false,
      paneIndex:  0,
      seriesArr:  [],
    };
    if(!ind.visible) return ind;
    var minNeeded = (params.period || params.slow || params.lookback || 26) + 5;
    var candles = this._candles.filter(function(c){
      return c && c.time!==undefined && c.close!==undefined;
    });
    if(candles.length >= Math.min(minNeeded, 15)){
      var seriesDefs = null;
      try{ seriesDefs = def.calc(candles, params); }catch(e){}
      if(seriesDefs && seriesDefs.length > 0){
        ind.paneIndex = (def.pane==='separate') ? this._allocPane() : 0;
        this._createSeries(ind);
        var self = this;
        // SR y PSAR necesitan delay para que candleSeries este lista
        if(ind.type==='SR' || ind.type==='PSAR'){
          setTimeout(function(){ self._refreshData(ind); }, 150);
        } else {
          self._applyData(ind, seriesDefs);
        }
      }
    } else if(def.pane==='main'){
      ind.paneIndex = 0;
      this._createSeries(ind);
    }
    return ind;
  },

  _applyData: function(ind, seriesDefs) {
    for(var i=0;i<seriesDefs.length;i++){
      var sd=seriesDefs[i], s=ind.seriesArr[i];
      if(!s || s.type==='psar' || s.type==='sr') continue;
      if(!sd.data||!sd.data.length) continue;
      try{ s.series.setData(sd.data); }catch(e){}
    }
  },

  _allocPane: function() {
    if(!this._chart) return 0;
    var pane = this._chart.addPane();
    this._panes.push(pane);
    this._redistributePaneHeights();
    return this._panes.length;
  },

  _redistributePaneHeights: function() {
    if(!this._chart || !this._panes.length) return;
    var self = this;
    setTimeout(function(){
      try{
        var panes = self._chart.panes();
        if(!panes||!panes.length) return;
        panes[0].setStretchFactor(3);
        for(var i=1;i<panes.length;i++){
          try{ panes[i].setStretchFactor(1); }catch(e){}
        }
      }catch(e){}
    }, 50);
  },

  _clearAll: function() {
    var self = this;
    this._active.forEach(function(ind){ self._removeSeries(ind); });
    this._active = [];
    try{
      if(this._chart && this._chart.panes){
        var panes = this._chart.panes();
        for(var i=panes.length-1;i>=1;i--){ try{this._chart.removePane(i);}catch(e){} }
      }
    }catch(e){}
    this._panes = [];
    var ov = document.getElementById('chart-ind-overlays');
    if(ov) ov.innerHTML = '';
    // Limpiar markers y priceLines de la candleSeries
    if(this._candleSeries){
      try{ this._candleSeries.setMarkers([]); }catch(e){}
    }
  },

  _seriesMeta: function(type, params) {
    var map = {
      SMA:  [{type:'line', color:params.color||'#2563EB',      lineWidth:params.lineWidth||1.5}],
      EMA:  [{type:'line', color:params.color||'#B47514',      lineWidth:params.lineWidth||1.5}],
      BB:   [
        {type:'line', color:params.colorMid||'#78716C',  lineWidth:params.lineWidth||1, lineStyle:2},
        {type:'line', color:params.colorBand||'#2563EB', lineWidth:params.lineWidth||1},
        {type:'line', color:params.colorBand||'#2563EB', lineWidth:params.lineWidth||1},
      ],
      RSI:  [
        {type:'line', color:params.color||'#B47514',    lineWidth:1.5},
        {type:'line', color:'#D93B3B60', lineWidth:1, lineStyle:2},
        {type:'line', color:'#56A14F60', lineWidth:1, lineStyle:2},
        {type:'line', color:'#2C292680', lineWidth:1, lineStyle:2},
      ],
      MACD: [
        {type:'line',      color:params.colorMACD||'#2563EB',   lineWidth:1.5},
        {type:'line',      color:params.colorSignal||'#D86326', lineWidth:1.5},
        {type:'histogram', color:params.colorHist||'#56A14F'},
      ],
      PSAR: [{type:'psar', color:params.colorBull||'#56A14F'}],
      SR:   [{type:'sr',   color:params.colorSupport||'#56A14F80'}],
    };
    return map[type] || [{type:'line', color:'#78716C', lineWidth:1.5}];
  },

  _createSeries: function(ind) {
    if(!this._chart||!this._lwc) return;
    var self  = this;
    var metas = this._seriesMeta(ind.type, ind.params);
    metas.forEach(function(meta){
      if(meta.type==='psar' || meta.type==='sr'){
        ind.seriesArr.push({series:null, type:meta.type, priceLines:[]});
        return;
      }
      var series;
      try{
        if(meta.type==='histogram'){
          series = self._chart.addSeries(self._lwc.HistogramSeries,{
            color:meta.color,
            priceFormat:{type:'price',precision:6,minMove:0.000001},
            priceScaleId:ind.id+'_hist',
          }, ind.paneIndex);
        } else {
          series = self._chart.addSeries(self._lwc.LineSeries,{
            color:meta.color, lineWidth:meta.lineWidth||1.5, lineStyle:meta.lineStyle||0,
            priceFormat:{type:'price',precision:6,minMove:0.000001},
            lastValueVisible:false, priceLineVisible:false, crosshairMarkerVisible:false,
          }, ind.paneIndex);
        }
        ind.seriesArr.push({series:series, type:meta.type});
      }catch(e){ console.warn('[ind] createSeries:', e.message); }
    });
  },

  _removeSeries: function(ind) {
    var self = this;
    ind.seriesArr.forEach(function(s){
      if(s.type==='sr'){
        if(s.priceLines && self._candleSeries){
          s.priceLines.forEach(function(pl){
            try{ self._candleSeries.removePriceLine(pl); }catch(e){}
          });
        }
        return;
      }
      if(s.type==='psar'){
        if(self._candleSeries){
          try{ self._candleSeries.setMarkers([]); }catch(e){}
        }
        return;
      }
      try{ self._chart.removeSeries(s.series); }catch(e){}
    });
    ind.seriesArr = [];
  },

  _refreshData: function(ind) {
    if(!ind.seriesArr.length||!this._candles.length) return;
    var def = IndicatorRegistry.get(ind.type);
    if(!def) return;
    var minNeeded = (ind.params.period||ind.params.slow||ind.params.lookback||26)+5;
    var candles = this._candles.filter(function(c){
      return c && c.time!==undefined && c.close!==undefined;
    });
    if(candles.length < Math.min(minNeeded, 10)) return;
    try{
      var sd = def.calc(candles, ind.params);
      var self = this;
      sd.forEach(function(s,i){
        var sr = ind.seriesArr[i];
        if(!sr) return;

        if(sr.type==='psar'){
          if(!self._candleSeries) return;
          var markers = [];
          (s.bull||[]).forEach(function(pt){
            markers.push({time:pt.time, position:'belowBar', color:s.colorBull||'#56A14F', shape:'circle', size:0.5});
          });
          (s.bear||[]).forEach(function(pt){
            markers.push({time:pt.time, position:'aboveBar', color:s.colorBear||'#D93B3B', shape:'circle', size:0.5});
          });
          markers.sort(function(a,b){return a.time-b.time;});
          try{ self._candleSeries.setMarkers(markers); }catch(e){}
          return;
        }

        if(sr.type==='sr'){
          if(sr.priceLines){
            sr.priceLines.forEach(function(pl){
              try{ self._candleSeries.removePriceLine(pl); }catch(e){}
            });
          }
          sr.priceLines = [];
          if(!self._candleSeries) return;
          var allZ = (s.supports||[]).concat(s.resistances||[]);
          allZ.forEach(function(z){
            try{
              var pl = self._candleSeries.createPriceLine({
                price:z.price, color:z.color,
                lineWidth:1, lineStyle:2,
                axisLabelVisible:true,
                title: s.supports&&s.supports.indexOf(z)>=0 ? 'S' : 'R',
              });
              sr.priceLines.push(pl);
            }catch(e){}
          });
          return;
        }

        if(!s.data||!s.data.length) return;
        try{ sr.series.setData(s.data); }catch(e){}
      });
    }catch(e){ console.warn('[ind] refreshData:', e.message); }
  },

  _renderOverlays: function() {
    document.querySelectorAll('.axiom-ind-overlay').forEach(function(el){ el.remove(); });
    if(!this._chart || !this._active.length) return;

    var paneEls = [];
    try{
      var lwcPanes = this._chart.panes();
      for(var pi=0;pi<lwcPanes.length;pi++){
        paneEls[pi] = lwcPanes[pi].getHTMLElement();
      }
    }catch(e){ return; }

    var byPane = {};
    this._active.forEach(function(ind){
      var pi = ind.paneIndex||0;
      if(!byPane[pi]) byPane[pi]=[];
      byPane[pi].push(ind);
    });

    var self = this;

    function makeBtn(icon, baseColor) {
      var b = document.createElement('button');
      b.style.cssText = 'border:none;background:transparent;color:'+baseColor+';cursor:pointer;font-size:11px;padding:1px 3px;line-height:1;';
      b.innerHTML = '<i class="ti '+icon+'"></i>';
      b.addEventListener('mouseenter', function(){ b.style.color='#F5F0EB'; });
      b.addEventListener('mouseleave', function(){ b.style.color=baseColor; });
      return b;
    }

    function makeRow(ind) {
      var def = IndicatorRegistry.get(ind.type);
      if(!def) return null;
      var col  = ind.params.color||ind.params.colorMACD||ind.params.colorLine||ind.params.colorMid||ind.params.colorBull||'#78716C';
      var eyeC = ind.visible ? '#78716C' : '#57534E';

      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:3px;padding:2px 6px;border-bottom:0.5px solid rgba(44,41,38,.5);';

      var dot = document.createElement('span');
      dot.style.cssText = 'display:inline-block;width:10px;height:2px;border-radius:1px;background:'+col+';flex-shrink:0;margin-right:2px;';
      row.appendChild(dot);

      var lbl = document.createElement('span');
      lbl.style.cssText = 'font-family:var(--f2);font-size:10px;color:#A8A29E;white-space:nowrap;margin-right:2px;';
      lbl.textContent = def.summary(ind.params);
      row.appendChild(lbl);

      var cfg = makeBtn('ti-settings', '#57534E');
      cfg.title = 'Configurar';
      cfg.addEventListener('click', function(){ ChartsScreen._openIndicatorsModal('config', ind.id); });
      row.appendChild(cfg);

      var eyeI = ind.visible ? 'ti-eye' : 'ti-eye-off';
      var tog  = makeBtn(eyeI, eyeC);
      tog.title = ind.visible ? 'Ocultar' : 'Mostrar';
      tog.addEventListener('click', function(){
        IndicatorManager.toggleVisible(ind.id).then(function(){
          ChartsScreen._updateIndCount();
          IndicatorManager._scheduleOverlayRender();
        });
      });
      row.appendChild(tog);

      var rem = makeBtn('ti-x', '#57534E');
      rem.title = 'Eliminar';
      rem.addEventListener('click', function(){
        IndicatorManager.remove(ind.id).then(function(){
          ChartsScreen._updateIndCount();
          IndicatorManager._scheduleOverlayRender();
        });
      });
      row.appendChild(rem);

      return row;
    }

    Object.keys(byPane).map(Number).sort(function(a,b){return a-b;}).forEach(function(pi){
      var inds    = byPane[pi];
      var paneEl  = paneEls[pi];
      if(!paneEl) return;
      paneEl.style.position = 'relative';

      if(pi === 0){
        var wrap = document.createElement('div');
        wrap.classList.add('axiom-ind-overlay');
        wrap.style.cssText = 'position:absolute;top:6px;left:6px;z-index:15;pointer-events:auto;background:rgba(15,14,13,.85);border-radius:4px;border:0.5px solid rgba(44,41,38,.7);overflow:hidden;min-width:60px;';

        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 7px;cursor:pointer;user-select:none;';

        var hCount = document.createElement('span');
        hCount.style.cssText = 'font-family:var(--f2);font-size:11px;font-weight:700;color:var(--cy);';
        hCount.textContent = inds.length.toString();

        var hArrow = document.createElement('span');
        hArrow.style.cssText = 'font-size:9px;color:#57534E;';
        hArrow.textContent = '\u25be';

        header.appendChild(hCount);
        header.appendChild(hArrow);

        var body = document.createElement('div');
        body.style.cssText = 'border-top:0.5px solid rgba(44,41,38,.5);';
        body.style.display = self._mainPaneCollapsed ? 'none' : 'block';
        hArrow.textContent = self._mainPaneCollapsed ? '\u25b8' : '\u25be';

        inds.forEach(function(ind){
          var row = makeRow(ind);
          if(row) body.appendChild(row);
        });

        header.addEventListener('mousedown', function(e){
          e.stopPropagation(); e.preventDefault();
          self._mainPaneCollapsed = !self._mainPaneCollapsed;
          body.style.display = self._mainPaneCollapsed ? 'none' : 'block';
          hArrow.textContent = self._mainPaneCollapsed ? '\u25b8' : '\u25be';
        });
        header.addEventListener('mouseup',  function(e){ e.stopPropagation(); e.preventDefault(); });
        header.addEventListener('click',    function(e){ e.stopPropagation(); e.preventDefault(); });

        wrap.appendChild(header);
        wrap.appendChild(body);
        paneEl.appendChild(wrap);

      } else {
        inds.forEach(function(ind, j){
          var row = makeRow(ind);
          if(!row) return;
          row.classList.add('axiom-ind-overlay');
          row.style.cssText = 'position:absolute;top:'+(6+j*22)+'px;left:6px;z-index:15;pointer-events:auto;background:rgba(15,14,13,.85);border-radius:3px;border:0.5px solid rgba(44,41,38,.7);display:flex;align-items:center;gap:3px;padding:2px 6px;';
          paneEl.appendChild(row);
        });
      }
    });
  },

  getActive: function(){ return this._active; },

  updateLastCandle: function(updatedCandle) {
    if(!this._candles.length||!this._active.length) return;
    var last = this._candles[this._candles.length-1];
    if(last.time !== updatedCandle.time) return;
    this._candles[this._candles.length-1] = Object.assign({}, last, updatedCandle);
    var candles = this._candles;
    var self = this;
    this._active.forEach(function(ind){
      if(!ind.visible||!ind.seriesArr.length) return;
      if(ind.type==='SR') return; // SR no necesita actualizar en tiempo real
      var def = IndicatorRegistry.get(ind.type);
      if(!def) return;
      var minNeeded = (ind.params.period||ind.params.slow||26)+5;
      if(candles.length<minNeeded) return;
      try{
        var sd = def.calc(candles, ind.params);
        sd.forEach(function(s,i){
          var sr = ind.seriesArr[i];
          if(!sr) return;
          if(sr.type==='psar'){
            // Actualizar ultimo marker
            var markers = [];
            (s.bull||[]).forEach(function(pt){
              markers.push({time:pt.time, position:'belowBar', color:s.colorBull||'#56A14F', shape:'circle', size:0.5});
            });
            (s.bear||[]).forEach(function(pt){
              markers.push({time:pt.time, position:'aboveBar', color:s.colorBear||'#D93B3B', shape:'circle', size:0.5});
            });
            markers.sort(function(a,b){return a.time-b.time;});
            try{ self._candleSeries.setMarkers(markers); }catch(e){}
            return;
          }
          if(!s.data||!s.data.length) return;
          var lp = s.data[s.data.length-1];
          if(lp) try{ sr.series.update(lp); }catch(e){}
        });
      }catch(e){}
    });
  },
};
