const Kore = Object.create(null);
Kore.bufferSize = 100_000;
Kore.workerRunners = new Map();
try {
  Kore.isWorkerThread = self instanceof WorkerGlobalScope;
} catch{
  Kore.isWorkerThread = false;
}
Kore.isMainThread = !Kore.isWorkerThread;
Kore.decoder = new TextDecoder();
//console.log(Array.from(new Uint8Array(view.buffer)).reduce((a, c)=>a+','+c, ''));
Kore.parseBuffer = (view, v = {c:0})=>{
  let cursor = v.c;
  const type = view.getInt8(cursor);
  switch (type) {
    case 0: { // BigInt
      v.v = Number(view.getBigInt64(cursor + 1));
      v.c = cursor + 9;
      return v;
    }
    case 1: { // double
      v.v = view.getFloat64(cursor + 1);
      v.c = cursor + 9;
      return v;
    }
    case 2:{ // string
      const length = view.getInt32(cursor + 1);
      const buf = new Uint8Array(new ArrayBuffer(length));
      buf.set(new Uint8Array(view.buffer.slice(cursor + 5, cursor + 5 + length)));
      v.v = Kore.decoder.decode(buf);
      v.c = cursor + 5 + length;
      return v;
    }
    case 3: { // boolean
      v.v = view.getUint8(cursor + 1) === 1;
      v.c = cursor + 2;
      return v;
    }
    case 4: { // array
      const length = view.getInt32(cursor + 1);
      const array = [];
      let i = 0;
      while (i < length) {
        const {v:value, c:nextCursor} = Kore.parseBuffer(view, {c:cursor + 5});
        array.push(value);
        cursor = nextCursor;
        i++;
      }
      v.v = array;
      v.c = cursor;
      return v;
    }
    case 5: { // object
      const length = view.getInt32(cursor + 1);
      const object = Object.create(null);
      let i = 0;
      while (i < length) {
        const {v:key, c:nextCursor} = Kore.parseBuffer(view, {c:cursor + 5});
        const {v:value, c:nextNextCursor} = Kore.parseBuffer(view, {c:nextCursor});
        object[key] = value;
        cursor = nextNextCursor;
        i++;
      }
      v.v = object;
      v.c = cursor;
      return v;
    }
  }
};

if(Kore.isWorkerThread){
  self.onmessage = event=>{
    if(crossOriginIsolated && event.data instanceof SharedArrayBuffer){
      const view = new DataView(event.data);
      const id = view.getUint8(0);
      const data = Kore.parseBuffer(view, {c:2}).v;
      console.log('worker sab', id, data);
      setTimeout(_=>{
        view.setUint8(1, 1); // 0: not completed, 1: completed
        self.postMessage(event.data);
      }, 1000);
    }else{
      const {id, data} = event.data;
      console.log('worker v', id, data);
      setTimeout(_=>{
        const isCompleted = true;
        self.postMessage({id, data, isCompleted});
      }, 1000);
    }
  }
}else{
  Kore.binder = limit=> Kore.Binder.add(limit);
  Kore.Binder = class{
    static items = [];
    static f = _=>{
      let i = 0, j = this.items.length;
      while(i < j){
        this.items[i].process();
        i++;
      }
      requestAnimationFrame(this.f);
    }
    static #isInit = false;
    static init(){
      if(this.#isInit) return;
      this.#isInit = true;
      requestAnimationFrame(this.f);
    }
    static add(limit){
      const binder = new this(limit);
      this.items.push(binder);
      this.init();
      return binder;
    }
    #queue = Object.create(null)
    #limit;
    constructor(limit){
      this.#limit = limit;

    }
    add(data){
      const id = data.view.viewId;
      (this.#queue[id] || (this.#queue[id] = Object.create(null)))[data.name] = data;
    }
    process(){
      const start = performance.now();
      for(const id in this.#queue){
        const items = this.#queue[id];
        for(const key in items){
          const data = items[key];
          const el = data.view.el;
          switch(data.type){
            case"f":
              View.setF[data.name](data.view, data.value);
              break;
            case "attr":
              el.setAttribute(data.name, data.value);
              break;
            case "prop":
              el[data.name] = data.value;
              break;
            case "style":
              el.style[data.name] = data.value;
              break;
          }
          delete items[key];
          if(performance.now() - start > this.#limit) return;
        }
        delete this.#queue[id];
      }
    }
  }
  Kore.view = (binder, el)=> new Kore.View(binder, el);
  Kore.View = class{
    static viewId = 0;
    static setF = Object.create(null);
    static getF = Object.create(null);
    static get(name){
      return this.getF[name];
    }
    #children;
    constructor(binder, el){
      this.binder = binder;
      this.el = el;
      el.view = this;
      this.#children = {};
      this.id = this.constructor.viewId++;
    }
    set(name, value){
      if(this.constructor.setF[name]) throw new Error(`no setter: ${name}`);
      this.binder.add({type:"f", view:this, name, value});
    }
    get(name){
      return this.constructor.get(name);
    }
    setAttr(name, value){
      this.binder.add({type:"attr", view:this, name, value});
    }
    getAttr(name){
      return this.el.getAttribute(name);
    }
    setProp(name, value){
      this.binder.add({type:"prop", view:this, name, value});
    }
    getProp(name){
      return this.el[name];
    }
    setStyle(name, value){
      this.binder.add({type:"style", view:this, name, value});
    }
    getStyle(name){
      return this.el.style[name];
    }
    setContent(content, block){
      this.el.innerHTML = content;
      this.#children = {};
      this.el.querySelectorAll("[kore]").forEach(el=>{
        this.#children[el.getAttribute("kore")] = new this.constructor(this.binder, el);
        this.render(block);
      });
    }
    sub(name){
      return this.#children[name];
    }
    render(block){
      block(this);
    }
  }

  Kore.Thread = class{
    static READY = Object.create(null);
    static WORKING = Object.create(null);
    static #listener = [];
    static #path = (_=>{
      if(document.currentScript) return document.currentScript.src;
      else{
        const scripts = document.getElementsByTagName('script');
        return scripts[scripts.length-1].src;
      }
    })();
    static #pool = null;
    static #states = null;
    static #queue = [];
    static #buffers = [];
    static #onMessage = event=>{
      if(crossOriginIsolated && event.data instanceof SharedArrayBuffer){
        const view = new DataView(event.data);
        const id = view.getUint8(0);
        if(view.getUint8(1) === 1) this.#states[id] = this.READY; // 0: not completed, 1: completed
        const data = Kore.parseBuffer(event.data, {c:2}).v;
        let i = 0, j = this.#listener.length;
        while (i < j) this.#listener[i++](data);
        if (this.#queue.length) this.postBuffer(this.#queue.shift());
      }else{
        const {id, data, isCompleted} = event.data;
        if (isCompleted) this.#states[id] = this.READY;
        let i = 0, j = this.#listener.length;
        while (i < j) this.#listener[i++](data);
        if (this.#queue.length) this.postMessage(this.#queue.shift());
      }
    }
    static init(){
      if(this.#pool) return;
      this.#pool = [];
      this.#states = [];
      const count = navigator.hardwareConcurrency || 4;
      console.log('thread count:', count);
      let i = 0;
      while(i++ < count){
        const worker = new Worker(this.#path);
        worker.onmessage = this.#onMessage;
        this.#pool.push(worker);
        this.#states.push(this.READY);
      }
    }
    static addListener(callback){
      this.#listener.push(callback);
    }
    static postMessage(data){
      this.init();
      let id = 0, j = this.#pool.length;
      while(id < j){
        if(this.#states[id] === this.READY){
          this.#states[id] = this.WORKING;
          this.#pool[id].postMessage({id, data});
          return;
        }
        id++;
      }
      this.#queue.push(data);
    }
    static #view = new DataView(new ArrayBuffer(1));
    static postBuffer(data){
      if(!crossOriginIsolated) throw new Error('SharedArrayBuffer is not allowed');
      this.init();
      let id = 0, j = this.#pool.length;
      while(id < j){
        if(this.#states[id] === this.READY){
          this.#states[id] = this.WORKING;
          if(!this.#buffers[id]) this.#buffers[id] = new SharedArrayBuffer(Kore.bufferSize);
          const view = new DataView(this.#buffers[id]);
          view.setUint8(0, id);
          view.setUint8(1, 0); // 0: not completed, 1: completed
          this.#writeBuffer(2, data, view);
          this.#pool[id].postMessage(this.#buffers[id]);
          return;
        }
        id++;
      }
      this.#queue.push(data);
    }
    static #encoder = new TextEncoder();
    static #writeBuffer = (cursor, v, view)=> {
      switch (typeof v) {
        case 'undefined': throw new Error('undefined is not allowed');
        case 'number':
          if(cursor + 9 > Kore.bufferSize) throw new Error('buffer overflow');
          if(Number.isInteger(v)){
            view.setInt8(cursor, 0); // 0: BigInt
            view.setBigInt64(cursor+1, BigInt(v));
          }else{
            view.setInt8(cursor, 1); // 1: double
            view.setFloat64(cursor+1, v);
          }
          return cursor + 9;
        case 'string':
          const bytes = this.#encoder.encode(v);
          const length = bytes.length;
          if(cursor + 5 + length > Kore.bufferSize) throw new Error('buffer overflow');
          view.setInt8(cursor, 2); // 2: string
          view.setInt32(cursor+1, length);
          let i = 0;
          while(i < length) view.setUint8(cursor+5+i, bytes[i++]);
          return cursor + 5 + length;
        case 'boolean':
          if(cursor + 2 > Kore.bufferSize) throw new Error('buffer overflow');
          view.setInt8(cursor, 3); // 3: boolean
          view.setUint8(cursor+1, v ? 1 : 0);
          return cursor + 2;
        case 'object':
          if(v === null) throw new Error('null is not allowed');
          if(cursor + 5 > Kore.bufferSize) throw new Error('buffer overflow');
          if (v instanceof Array){
            view.setInt8(cursor, 4); // 4: array
            const length = v.length;
            view.setInt32(cursor+1, length);
            let i = 0;
            while(i < length) cursor = this.#writeBuffer(cursor+5, v[i++], view);
          }else{
            console.log("object: ", v, cursor);
            view.setInt8(cursor, 5); // 5: object
            const keys = Object.keys(v);
            const length = keys.length;
            view.setInt32(cursor+1, length);
            let i = 0;
            while(i < length){
              cursor = this.#writeBuffer(cursor+5, keys[i], view);
              console.log("object key: ", keys[i], cursor, view.buffer.byteLength);
              cursor = this.#writeBuffer(cursor, v[keys[i++]], view);
            }
          }
          return cursor;
      }
    }
  }
}
Object.freeze(Kore);
