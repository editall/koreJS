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
if(true) {
  const r2p = r=>new Promise((resolve, reject)=>{
    r.onsuccess = e=>resolve(e.target.result);
    r.onerror = reject;
  });
  const Join = class Join {
    table;
    join;
    tableKey;
    joinKey;
    where = [];
    constructor(table, join, tableKey, joinKey) {
      this.table = table;
      this.join = join;
      this.tableKey = tableKey;
      this.joinKey = joinKey;
    }
    equal(key, paramIndex, paramKey){
      this.where.push({op:"=", key, paramIndex, paramKey});
      return this;
    }
    notEqual(key, paramIndex, paramKey){
      this.where.push({op:"!=", key, paramIndex, paramKey});
      return this;
    }
    lessThan(key, paramIndex, paramKey){
      this.where.push({op:"<", key, paramIndex, paramKey});
      return this;
    }
    lessThanOrEqual(key, paramIndex, paramKey){
      this.where.push({op:"<=", key, paramIndex, paramKey});
      return this;
    }
    greaterThan(key, paramIndex, paramKey){
      this.where.push({op:">", key, paramIndex, paramKey});
      return this;
    }
    greaterThanOrEqual(key, paramIndex, paramKey){
      this.where.push({op:">=", key, paramIndex, paramKey});
      return this;
    }
    like(key, paramIndex, paramKey){
      this.where.push({op:"like", key, paramIndex, paramKey});
      return this;
    }
    notLike(key, paramIndex, paramKey){
      this.where.push({op:"not like", key, paramIndex, paramKey});
      return this;
    }
    in(key, paramIndex, paramKey){
      this.where.push({op:"in", key, paramIndex, paramKey});
      return this;
    }
    notIn(key, paramIndex, paramKey){
      this.where.push({op:"not in", key, paramIndex, paramKey});
      return this;
    }
    and(){
      this.where.push({op:"and"});
      return this;
    }
    or(){
      this.where.push({op:"or"});
      return this;
    }
    #query(query, store, indexes, key) {
      return r2p(indexes.contains(key) ? store.index(key).getAll(query) : store.getAll(query));
    }
    async whereProcess(txStore, params) {
      const tableName = this.table;
      const store = txStore[tableName] ?? (
          txStore[tableName] = txStore.__tx.objectStore(tableName)
      );
      if(!this.where.length) return await r2p(store.getAll());
      const keyPath = store.keyPath;
      const indexes = store.indexNames;
      const w = this.where;
      let i = 0, j = w.length, connector = "or", result = [];
      while (i < j) {
        const {op, key, paramIndex, paramKey} = w[i++];
        let curr;
        switch (op) {
          case "=": {
            curr = await this.#query(IDBKeyRange.only(params[paramIndex][paramKey]), store, indexes, key);
            break;
          }
          case "!=": {
            const value = params[paramIndex][paramKey];
            curr = await r2p(store.getAll()).then(r => r.filter(c => c[key] !== value));
            break;
          }
          case "in":{
            const value = params[paramIndex][paramKey];
            const count = store.count();
            if(count > 3000 || value > 3000 || (value / count) > 0.3){
              curr = await r2p(store.getAll()).then(r => r.filter(c => value.includes(c[key])));
            }else{
              let i = 0, j = value.length;
              const unique = new Set();
              curr = [];
              while(i < j){
                const v = value[i++];
                const r = await this.#query(IDBKeyRange.only(v), store, indexes, key);
                r.forEach(c=>{
                  if(!unique.has(c[keyPath])){
                    unique.add(c[keyPath]);
                    curr.push(c);
                  }
                });
              }
            }
            break;
          }
          case "<": {
            curr = await this.#query(IDBKeyRange.upperBound(params[paramIndex][paramKey]), store, indexes, key);
            break;
          }
          case "<=": {
            curr = await this.#query(IDBKeyRange.upperBound(params[paramIndex][paramKey], true), store, indexes, key);
            break;
          }
          case ">": {
            curr = await this.#query(IDBKeyRange.lowerBound(params[paramIndex][paramKey]), store, indexes, key);
            break;
          }
          case ">=": {
            curr = await this.#query(IDBKeyRange.lowerBound(params[paramIndex][paramKey], true), store, indexes, key);
            break;
          }
          case "like": {
            curr = await r2p(store.getAll());
            let value = params[paramIndex][paramKey];
            if (value[0] === "%" && value[value.length - 1] === "%") {
              value = value.slice(1, -1);
              curr = curr.filter(c => c[key].indexOf(value) > -1);
            } else if (value[0] === "%") {
              value = value.slice(1);
              curr = curr.filter(c => c[key].endsWith(value));
            } else if (value[value.length - 1] === "%") {
              value = value.slice(0, -1);
              curr = curr.filter(c => c[key].startsWith(value));
            } else {
              curr = curr.filter(c => c[key] === value);
            }
            break;
          }
          case "or":
          case "and": {
            connector = op;
            break;
          }
        }
        if (op !== "or" && op !== "and") {
          if (connector === "and") {
            result = result.filter(r => curr.some(c => r[keyPath] === c[keyPath]));
          } else if (connector === "or") {
            if (result.length) curr.forEach(c => result.every(r => r[keyPath] !== c[keyPath]) && result.push(c));
            else result = curr;
          }
        }
      }
      return result;
    }
  };
  const Select = class Select {
    #db;
    #joins = [];
    #fields = [];
    #order = [];
    constructor(from, db, block){
      this.#db = db;
      const join = new Join(from, null, null, null);
      this.#joins.push(join);
      block(this, join);
    }
    /**
     * @param table {string}
     * @param tableKey {string}
     * @param join {Join}
     * @param joinKey {string}
     * @return {Join}
     */
    join(table, tableKey, join, joinKey){
      const j = new Join(table, join, tableKey, joinKey);
      this.#joins.push(j);
      return j;
    }
    /**
     * @param join {Join}
     * @param key {string}
     * @param [toKey] {string}
     * @return {Select}
     */
    project(join, key, toKey ){
      this.#fields.push({join, key, toKey});
      return this;
    }
    orderBy(key, isAsc = true) {
      this.#order.push({key, isAsc});
      return this;
    }
    /**
     * @param params {any[]}
     * @return {Promise<any[]>}
     */
    async query(params){
      if(!this.#fields.length) throw new Error("no projection field");
      const whereProcessed = Object.create(null), txStore = Object.create(null);
      txStore.__tx = this.#db.transactionRead();
      let i = 0, j = this.#joins.length, rs;
      while(i < j){
        const curr = this.#joins[i];
        const {table, join, tableKey, joinKey} = curr;
        const tableWhere = whereProcessed[table] || (
            whereProcessed[table] = await curr.whereProcess(txStore, params)
        );
        console.log('tableWhere', table, tableWhere);
        if(!tableWhere.length){
          rs = [];
          break;
        }
        if(!rs){
          rs = tableWhere.map(t=>{
            const record = Object.create(null);
            record[i] = t;
            return record;
          });
        }else{
          const joinIndex = this.#joins.indexOf(join), joined = [];
          rs.forEach(r=>{
            const ref = r[joinIndex][joinKey];
            tableWhere.forEach(t=>{
              if(t[tableKey] !== ref) return;
              const record = Object.assign(Object.create(null), r);
              record[i] = t;
              joined.push(record);
            });
          });
          if(!joined.length){
            rs = [];
            break;
          }
          rs = joined;
        }
        i++;
      }
      return !rs.length ? rs : new Promise((resolve, reject)=>{
        txStore.__tx.oncomplete =_=>{
          const result = rs.map(r=>this.#fields.reduce((acc, {join, key, toKey})=>{
            const joinIndex = this.#joins.indexOf(join);
            acc[toKey ?? key] = r[joinIndex][key];
            return acc;
          }, Object.create(null)));
          if(this.#order.length){
            result.sort((a, b)=>{
              let i = 0, j = this.#order.length;
              while(i < j){
                const {key, isAsc} = this.#order[i++];
                if(a[key] > b[key]) return isAsc ? 1 : -1;
                if(a[key] < b[key]) return isAsc ? -1 : 1;
              }
              return 0;
            });
          }
          resolve(result);
        }
        txStore.__tx.onerror = reject;
        txStore.__tx.commit();
      });
    }
  }
  /**
   * @abstract
   * @class
   * @type {Kore.IndexedDB}
   */
  Kore.IndexedDB = class IndexedDB {
    static Table = class Table{
      #store;
      constructor(store){this.#store = store;}
      index(keyPath, unique) {
        this.#store.createIndex(keyPath, keyPath, {unique});
        return this;
      }
    };
    #db;
    #openAwait;
    #isFirst = false;
    constructor(dbName){
      this.#openAwait = new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = e => {
          this.onError(e);
          reject(e);
        };
        request.onupgradeneeded = e => {
          this.#db = e.target.result;
          this.onCreate()
        };
        request.onsuccess = e => {
          this.#db = e.target.result;
          if(this.#isFirst) this.onInit().then(resolve); else resolve();
        };
      });
    }
    /**
     * @abstract
     * @return {void}
     */
    onCreate() {
      throw new Error("abstract method");
    }
    /**
     * @abstract
     * @return {Promise<void>}
     */
    async onInit() {
      throw new Error("abstract method");
    }
    /**
     * @abstract
     * @param e {Event}
     * @return {void}
     */
    onError(e) {
      throw new Error("abstract method");
    }
    table(name, keyPath, autoIncrement) {
      this.#isFirst = true;
      return new IndexedDB.Table(
          this.#db.createObjectStore(name, {keyPath, autoIncrement})
      );
    }
    async select(from, block) {
      await this.#openAwait;
      return new Select(from, this, block);
    }
    /**
     * @return {IDBTransaction}
     */
    transactionRead(){
      return this.#db.transaction(this.#db.objectStoreNames, "readonly");
    }
    async insert(table, data) {
      const tx = this.#db.transaction(table, "readwrite");
      const store = tx.objectStore(table);
      store.add(data);
      return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = reject;
      });
    }
    async bulkInsert(table, data) {
      const tx = this.#db.transaction(table, "readwrite");
      const store = tx.objectStore(table);
      data.forEach(d => store.add(d));
      return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = reject;
      });
    }
  }
}
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
  /**
   * @typedef {Object} Data
   * @property {HTMLElement} el
   * @property {string} type
   * @property {Kore.View} view
   * @property {string} name
   * @property {*} value
   * @property {function(Kore.View, string, *):void} [block]
   * @property {number} [delay]
   */
  /**
   * @param size {number}
   * @returns {Kore.MapQueue}
   */
  Kore.mapQueue = (size)=>new Kore.MapQueue(size);
  Kore.MapQueue = class MapQueue{
    #keys = Object.create(null);
    /** @type {number} */
    #size;
    #front = 0;
    #rear = 0;
    #length = 0;
    /**
     * @private
     * @param size {number}
     */
    constructor(size){
      this.#size = size;
    }
    length(){return this.#length;}
    /**
     * @param key {string}
     * @param value {*}
     * @returns {*|undefined} - *:update and old data, undefined:insert
     */
    set(key, value){
      if(this.#keys[key] === undefined){
        if(this.#length === this.#size) throw new Error('overflow');
        this.#keys[key] = this.#rear;
        this[this.#rear++] = value;
        if(this.#rear === this.#size) this.#rear -= this.#size;
        this.#length++;
      }else{
        const old = this[this.#keys[key]];
        this[this.#keys[key]] = value;
        return old;
      }
    }
    /**
     * @param key
     * @returns {*|null}
     */
    get(key){
      if(this.#keys[key] === undefined) return null;
      return this[this.#keys[key]];
    }
    remove(key){
      this.#keys[key] = undefined;
    }
    shift(){
      if(!this.#length) return null;
      this.#length--;
      const data = this[this.#front++];
      if(this.#front === this.#size) this.#front -= this.#size;
      return data;
    }
  };
  Kore.Pool = class Pool{
    length = 0;
    #front = 0;
    #rear = 0;
    #size = 0;
    #factory;
    constructor(factory, size = 500){
      this.#factory = factory;
      this.#size = size;
    }
    get(){
      if(!this.length) return this.#factory();
      else{
        this.length--;
        const data = this[this.#front++];
        if(this.#front === this.#size) this.#front -= this.#size;
        return data;
      }
    }
    set(data){
      this[this.#rear++] = data;
      if(this.#rear === this.#size) this.#rear -= this.#size;
    }
  }
  Kore.binder = (limit, thresholding = 100)=> Kore.Binder.add(limit, thresholding);
  Kore.Binder = class Binder{
    static items = [];
    static delayed = Object.create(null);
    static #isInit = false;
    static init(){
      if(this.#isInit) return;
      this.#isInit = true;
      const f =_=>{
        let i = 0, j = this.items.length;
        while(i < j){
          this.items[i].process();
          i++;
        }
        const now = performance.now();
        let key;
        for(key in this.delayed){
          const {view, name, value, block, delay} = this.delayed[key];
          if(now > delay){
            delete this.delayed[key];
            this.returnPool(this.delayed[key]);
            block(view, name, value);
          }
        }
        requestAnimationFrame(f);
      }
      requestAnimationFrame(f);
    }
    static add(limit, thresholding){
      const binder = new this(limit, thresholding);
      this.items.push(binder);
      this.init();
      return binder;
    }
    static #pool = new Kore.Pool(_=>Object.create(null));
    static #emptyData = {
      el:undefined, view:undefined, type:undefined, name:undefined,
      value:undefined, block:undefined, delay:undefined
    };
    /**
     * @returns {Data}
     */
    static getPool(){
      return this.#pool.get();
    }

    /**
     * @param data {Data}
     */
    static returnPool(data){
      Object.assign(data, this.#emptyData);
      return this.#pool.set(data);
    }
    #queue = Kore.mapQueue(30000);
    #limit;
    #thresholding;
    /**
     * @private
     * @constructor
     * @param limit {number}
     * @param thresholding {number}
     */
    constructor(limit, thresholding){
      this.#limit = limit;
      this.#thresholding = thresholding;
    }
    /**
     * @param type {string}
     * @param view {Kore.View}
     * @param name {string}
     * @param value {*}
     * @param block {(function(Kore.View, string, *):void)}
     * @param delay {number}
     */
    add(type, view, name, value, block = null, delay = null){
      const key = view.id + "_" + type + "_" + name;
      /** @type {Data} */
      let data;
      if(delay){
        data = this.constructor.delayed[key] ?? this.constructor.getPool();
        data.delay = delay + performance.now();
      }else data = this.constructor.getPool();
      data.type = type;
      data.view = view;
      data.el = view.el;
      data.name = name;
      data.value = value;
      data.block = block;
      if(!delay){
        const old = this.#queue.set(key, data);
        if(old){
          this.constructor.returnPool(old);
        }
      }
    }
    process(){
      const start = performance.now();
      let check = 0;
      /** @type {Data} */
      let data;
      while(data = this.#queue.shift()){
        const {el, view, name, type, value, block} = data;
        this.constructor.returnPool(data);
        this.#queue.remove(view.id + "_" + type + "_" + name);
        if(el === view.el){
          switch(type){
            case"f":
              block(view, name, value);
              break;
            case "attr":
              el.setAttribute(name, value);
              break;
            case "prop":
              el[name] = value;
              break;
            case "style":
              if(name === "all"){
                let i = 0, j = value.length;
                while(i < j) el.style[value[i++]] = value[i++];
              }else el.style[name] = value;
              break;
          }
        }
        if(check++ > this.#thresholding){
          if(performance.now() - start > this.#limit) return;
          check = 0;
        }
      }
    }
  }
  Kore.View = class View{
    /**
     * @private
     * @type {number}
     */
    static viewId = 0;
    /**
     * @private
     * @type {Object.<string, function(Kore.View, *)>}
     */
    static setF = Object.create(null);
    /**
     * @private
     * @type {Object.<string, function(Kore.View):*>}
     */
    static getF = Object.create(null);
    /**
     * @param name {string}
     * @param block {function(Kore.View, *)}
     */
    static set(name, block){
        this.setF[name] = block;
    }
    /**
     * @param name {string}
     * @param block {function(Kore.View):*}
     */
    static get(name, block){
        this.getF[name] = block;
    }
    /**
     * @readonly
     * @type {number}
     */
    id = Kore.View.viewId++;
    #workderId = 0;
    /**
     * @protected
     * @readonly
     * @type {Kore.Binder}
     */
    #binder;
    /**
     * @type {HTMLElement}
     */
    el;
    /**
     * @type {Object.<string, Kore.View>}
     */
    #children = Object.create(null);
    /**
     * @type {Object.<string, function(Kore.View, *):void>}
     */
    #dataListeners = Object.create(null);
    get binder(){return this.#binder;}
    /**
     * @param binder {Kore.Binder}
     * @param el {HTMLElement}
     * @returns {Kore.View}
     */
    reset(binder, el){
      this.#binder = binder;
      this.el = el;
      return this;
    }
    /**
     * @param name {string}
     * @param value {*}
     */
    set(name, value){
      const block = this.constructor.setF[name];
      if(block) throw new Error(`no setter: ${name}`);
      this.#binder.add("f", this, name, value, block);
    }
    /**
     * @param name {string}
     * @returns {*}
     */
    get(name){
      const getF = this.constructor.getF[name];
      if(getF) throw new Error(`no getter: ${name}`);
      return getF(this);
    }
    addEvent(type, block){
      this.el.addEventListener(type, block);
    }
    /**
     * @param name {string}
     * @param value {string}
     */
    setAttr(name, value){
      this.#binder.add("attr", this, name, value);
    }
    /**
     * @param name {string}
     * @returns {string}
     */
    getAttr(name){
      return this.el.getAttribute(name);
    }
    /**
     * @param name {string}
     * @param value {*}
     */
    setProp(name, value){
      this.#binder.add("prop", this, name, value);
    }
    /**
     * @param name {string}
     * @returns {*}
     */
    getProp(name){
      return this.el[name];
    }
    /**
     * @param name {string}
     * @param value {string}
     */
    setStyle(name, value){
      this.#binder.add("style", this, name, value);
    }
    /**
     * @param name {string}
     * @returns {*}
     */
    getStyle(name){
      return this.el.style[name];
    }
    action(name, value, block){
      this.#binder.add("f", this, name, value, block);
    }
    delay(delay, name, value, block){
      this.#binder.add("f", this, name, value, block, delay);
    }
    /**
     * @async
     * @param url {string}
     * @param block {function():*}
     * @returns {Promise<void>}
     */
    async loadContent(url, block){
        const response = await fetch(url);
        const content = await response.text();
        this.setContent(content, block);
    }
    /**
     * @param content {string}
     * @param block {(function():*)|null}
     */
    setContent(content, block = null){
      this.#children = Object.create(null);
      if(block){
        //const old = this.el;
        //this.el = this.el.cloneNode(false);
        this.el.innerHTML = content;
        this.el.querySelectorAll("[kore]").forEach(el=>{
          //if(this.#children[el.getAttribute("kore")]) throw new Error(`duplicate kore: ${el.getAttribute("kore")}`);
          this.#children[el.getAttribute("kore")] = new Kore.View().reset(this.#binder, el);
        });
        block();
        // this.action("content", this.#workderId++, _=>{
        //   old.parentNode?.replaceChild(this.el, old);
        // });
      }else{
        this.el.innerHTML = content;
        this.el.querySelectorAll("[kore]").forEach(el=>{
          this.#children[el.getAttribute("kore")] = new Kore.View().reset(this.#binder, el);
        });
      }
    }
    /**
     * @param prefix {string} - child name = prefix + index
     * @param comp {Kore.View[]}
     */
    setViews(prefix, comp){
      let i = 0, j = comp.length;
      const f =_=>{
        if(++i < j) return;
        const old = this.el;
        this.el = old.cloneNode(false);
        this.#children = {};
        i = 0;
        while(i < j){
          this.el.appendChild(comp[i].el);
          this.#children[prefix + i] = comp[i];
          i++;
        }
        old.parentNode?.replaceChild(this.el, old);
      };
      while(i < j){
        const c = comp[i++];
        c.action("setViews", this.#workderId++, f);
      }
      i = 0;
    }
    insertBeforeSubView(to, name, view, block = null){
      if(!this.#children[to]) throw new Error(`no such view: ${to}`);
      this.#children[name] = view;
      this.#children[to].el.parentNode.insertBefore(view.el, this.#children[to].el);
      if(block) block(view);
    }
    insertAfterSubView(to, name, view, block = null){
      if(!this.#children[to]) throw new Error(`no such view: ${to}`);
      this.#children[name] = view;
      this.#children[to].el.parentNode.insertBefore(view.el, this.#children[to].el.nextSibling);
      if(block) block(view);
    }
    /**
     * replace child to new View. if block, The view is replaced after all block operations on it are completed.
     * @param name {string}
     * @param view {Kore.View}
     * @param block {(function(Kore.View):void)|(function(Kore.View, *):void)|null}
     */
    replaceSubView(name, view, block = null){
      const old = this.#children[name];
      this.#children[name] = view;
      const f =_=>old?.el?.parentNode?.replaceChild(view.el, old.el);
      if(view instanceof Kore.Comp){
        view._onCreate(this.#binder);
        view.action("replaceSubView", this.#workderId++, _=>{
          if(block){
            view.onData(view.modelKey, block);
            view.setData(view.modelKey, view.model);
            view.action("replaceSubView", this.#workderId++, f);
          }else f();
        });
      }else{
        if(block){
          block(view);
          view.action("replaceSubView", this.#workderId++, f);
        }else f();
      }

    }
    /**
     * @throws NoSuchView
     * @param name {string}
     * @param block {function(Kore.View):*|null}
     * @returns {Kore.View}
     */
    sub(name, block = null){
      const view = this.#children[name];
      if(!view) throw new Error(`no such view: ${name}`);
      if(block) block(view);
      return view;
    }
    /**
     * @param key {string}
     * @param block {function(Kore.View, *):void}
     */
    onData(key, block){
      this.#dataListeners[key] = block;
    }
    /**
     * @param key {string}
     * @param value {*}
     */
    setData(key, value){
      this.#dataListeners[key]?.(this, value);
    }
  }
  /**
   * @param binder {Kore.Binder}
   * @param el {HTMLElement}
   * @param block {function(Kore.View):*|null}
   * @returns {Kore.View}
   */
  Kore.view = (binder, el, block = null)=>{
    const view = new Kore.View().reset(binder, el);
    if(block) block(view);
    return view;
  }
  /**
   * @abstract
   * @class
   * @type {Kore.Comp}
   */
  Kore.Comp = class Comp extends Kore.View{
    #tagName;
    model;
    modelKey;
    /**
     * @abstract
     * @param tagName {string}
     * @param model {*}
     * @param modelKey {string}
     */
    constructor(tagName, model, modelKey) {
      super();
      this.#tagName = tagName;
      this.model = model;
      this.modelKey = modelKey;
    }
    /**
     * @param binder {Kore.Binder}
     */
    _onCreate(binder){
      this.reset(binder, document.createElement(this.#tagName));
      this.onCreate();
    }
    /**
     * @abstract
     * @return {void}
     */
    onCreate() {
      throw new Error("abstract method");
    }
    /**
     * @abstract
     * @return {void}
     */
    onRender(){
      throw new Error("abstract method");
    }
    /**
     * @override
     */
    setData(key, value) {
      if(key === this.modelKey){
        this.model = value;
        this.onRender();
      }
      super.setData(key, value);
    }
  };
  /**
   * @abstract
   */
  Kore.PathRouterView = class PathRouterView extends Kore.View{
    #router = new Kore.PathRouter("/");
    constructor(binder, el, block) {
      super();
      super.reset(binder, el);
      block(this.#router);
      this.#router.after((key, data, result)=>{
        this.setViews("route", [result]);
      });
      this.#router.popState();
    }
    setPath(path, data){
      this.#router.go(path, data);
    }
  };
  Kore.pushState = (key, url, data = null)=>history.pushState(data, key, url);
  Kore.back =_=>history.back();
  Kore.forward =_=>history.forward();
  Kore.popState = block=>window.addEventListener("popstate", block);
  Kore.Router = class Router{
    /** @type {Map<String, {ref:*, block:function(*):*}>} */
    tables = new Map();
    /** @type {array<function(*):(*|void)>} */
    #before = [];
    /** @type {array<function(key:string, data:*, result:*):void>} */
    #after = [];
    /**
     * @param key {string}
     * @param ref {*}
     * @param block {function(*):*}
     */
    set(key, ref, block){
      this.tables.set(key, {ref, block});
    }
    /**
     * @param block {function(*):*}
     */
    before(block){
      this.#before.push(block);
    }
    /**
     * @param block {function(key:string, data:*, result:*):void}
     */
    after(block){
      this.#after.push(block);
    }
    run(rawData){
      const before = this.#before.reduce((acc, it)=>it(acc), rawData);
      const {key, data} = before && before.key && before.data ? before : this._route(rawData);
      let result;
      if(this.tables.has(key)) {
        const {ref, block} = this.tables.get(key);
        result = block(this._dataProcess(ref, data));
      }
      return this.#after.reduce((acc, it)=>it(key, data, acc), result);
    }
    /**
     * @abstract
     * @param rawData {*}
     * @return {{key:string, data:*}|{}}
     */
    _route(rawData){
      throw new Error("not implemented");
    }
    /**
     * @param ref {*}
     * @param data {*}
     * @return *
     */
    _dataProcess(ref, data){
      return data;
    }
  };
  Kore.PathRouter = class PathRouter extends Kore.Router{
    #base = "/";
    popState = _=>{
        if(!location.pathname.startsWith(this.#base)) return;
      // console.log('not match base', this.#base, location.pathname);
      this.run(location.pathname.substring(this.#base.length));
    };
    constructor(){
      super();
      Kore.popState(this.popState);
    }
    setBase(base) {
      if(base[0] !== "/" || base[base.length - 1] !== "/") throw new Error("invalid base. first and last character must be '/' :" + base);
      this.#base = base;
    }
    _route(rawData) {
      for(const key of this.tables.keys()){
        if(rawData.startsWith(key)) return {key, data:rawData.substring(key.length + 1).split("/")};
      }
      return {};
    }
    _dataProcess(ref, data){
      if(ref.length !== data.length) throw new Error("invalid data length");
      return ref.reduce((acc, it, index)=>{
        acc[it] = data[index];
        return acc;
      }, Object.create(null));
    }
    go(path, data){
      if(path[0] === "/" || path[path.length - 1] === "/") throw new Error("invalid path. first character and last character must be not '/' :" + path);
      if(this.tables.has(path)){
        const {ref, block} = this.tables.get(path);
        const url = path + "/" + ref.reduce((acc, it)=>{
          acc.push(data[it]);
          return acc;
        }, []).join("/");
        console.log("url", url);
        Kore.pushState(path, this.#base + url);
        this.run(url);
      }else location.pathname = this.#base + path + "/" + Object.values(data).join("/");
    }
  };
  const FetchArgs = class FetchArgs{
    url;
    #headers;
    #body;
    #mode = "cors";
    #responseType = "text";
    #method = "POST";
    #error;
    #completed;
    #data;
    constructor(url, block){
      this.url = url;
      block?.(this);
    }
    get body(){return JSON.stringify(this.#body);}
    set body(value){
      this.#body = value;
      this.header("Content-Type", "application/json");
    }
    get mode(){return this.#mode;}
    get CORS(){this.#mode = "cors";}
    get NO_CORS(){this.#mode = "no-cors";}
    get SAME_ORIGIN(){this.#mode = "same-origin";}
    get headers(){return this.#headers;}
    header(key, value){
      if(!this.#headers) this.#headers = new Headers();
      this.#headers.set(key, value);
    }
    get responseType(){return this.#responseType;}
    get TEXT(){this.#responseType = "text";}
    get BLOB(){this.#responseType = "blob";}
    get method(){return this.#method;}
    get GET(){this.#method = "GET";}
    get POST(){this.#method = "POST";}
    onError(block){this.#error = block;}
    onCompleted(block){this.#completed = block;}
    onData(block){this.#data = block;}
    complete(result){this.#completed?.(result);}
    error(e){this.#error?.(e);}
    data(data){return this.#data?.(data) ?? true;}
  };
  /**
   * @return {AsyncGenerator<Uint8Array|string, void, *>}
   * @param url {string}
   * @param block {(function(FetchArgs):void)}
   */
  Kore.fetchStream = async (url, block)=>{
    const arg = new FetchArgs(url, block);
    const controller = new AbortController();
    try {
      const option = {
        method:arg.method,
        mode:arg.mode,
        signal:controller.signal
      };
      if(arg.headers) option.headers = arg.headers;
      if(arg.body) option.body = arg.body;
      const response = await fetch(arg.url, option);
      const reader = response.body.getReader();
      let result = [];
      let {done, value} = await reader.read();
      while(!done){
        const v = arg.responseType === 'text' ? Kore.decoder.decode(value) : value;
        result.push(v);
        if(!arg.data(v)){
          controller.abort();
          return;
        }
        ({done, value} = await reader.read());
      }
      arg.complete(result);
      return result;
    }catch(e){
      if(e.name !== "AbortError") arg.error(e.message);
    }
  };
  Kore.Thread = class Thread{
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
    static post(data){
      return crossOriginIsolated ? this.postBuffer(data) : this.postMessage(data);
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
  };
}
Object.freeze(Kore);