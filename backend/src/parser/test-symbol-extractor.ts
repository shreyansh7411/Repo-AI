import { ParserService } from "./parser-service.js";
import { extractSymbols } from "./symbol-extractor.js";

const parser = await ParserService.initialize();

const javaSource = `
class PaymentService {
    private int balance;
    private String currency, status;

    public PaymentService() {
        balance = 0;
    }

    public int calculate(int amount) {
        return amount + balance;
    }
}
`;

const tsSource = `
interface User {
    id: number;
}

class UserService {
    private cache: Map<string, User>;
    private count = 0;

    getUser(id: number): User {
        return { id };
    }
}

const formatUser = (user: User) => user.id;
`;

const javaParsed = await parser.parseSource("PaymentService.java", javaSource);
const tsParsed = await parser.parseSource("UserService.ts", tsSource);

console.log("\\nJava symbols:");
console.table(extractSymbols(javaParsed, "PaymentService.java"));

console.log("\\nTypeScript symbols:");
console.table(extractSymbols(tsParsed, "UserService.ts"));
