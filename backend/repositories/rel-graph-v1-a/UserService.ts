
class UserService {
    getUser() {
        validateUser();
        this.loadUser();
        saveUser();
        cache.saveUser();
    }

    validateUser() {}
    loadUser() {}
    saveUser() {}
}
