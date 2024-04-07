class TestDB extends Kore.IndexedDB {
    constructor() {
        super("test");
    }
    onCreate() {
        console.log("onCreate")
        this.table("member", "rowid", true)
            .index("name", false);
        this.table("club", "rowid", true)
            .index("name", false);
        this.table("clubMember", "rowid", true)
            .index("club_rowid", false)
            .index("member_rowid", false);
    }
    async onInit() {
        console.log("onInit")
        await this.bulkInsert("member", [
            {name: "hika"}, {name: "jidolstar"}, {name: "boeun"}
        ]);
        await this.bulkInsert("club", [
            {name: "baseball"}, {name: "football"}, {name: "swimming"}
        ]);
        await this.bulkInsert("clubMember", [
            {club_rowid: 1, member_rowid: 1},
            {club_rowid: 1, member_rowid: 2},
            {club_rowid: 2, member_rowid: 2},
            {club_rowid: 2, member_rowid: 3},
            {club_rowid: 3, member_rowid: 1},
            {club_rowid: 3, member_rowid: 3}
        ]);
    }
    onError(e) {
        console.log(e);
    }
}
(async _=> {
    const testDB = new TestDB();
    const select= await testDB.select("member", (it, member)=>{
        const clubMember = it.join("clubMember", "member_rowid", member, "rowid");
        const club = it.join("club", "rowid", clubMember, "club_rowid");
        it.project(member, "rowid", "member_rowid")
            .project(member, "name", "member_name")
            .project(club, "rowid", "club_rowid")
            .project(club, "name", "club_name");
        it.orderBy("member_rowid", false)
            .orderBy("club_rowid", false);
        member.equal("name", 0, "name");
        // club.equal("name", 1, "name");
    });
    const a = await select.query([{name:"hika"},{name:"football"}]);
    console.log(a);

})();