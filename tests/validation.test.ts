import test from "node:test";
import assert from "node:assert/strict";
import { validateLoan } from "../src/lib/validators";

test("flags balance above principal",()=>{const issues=validateLoan({id:"LN-1",borrowerId:"BR-1",loanType:"Personal",originationDate:"2025-01-01",maturityDate:"2028-01-01",originalPrincipal:100,currentBalance:120,interestRate:8,termMonths:36,borrowerState:"CA",paymentStatus:"Current",daysPastDue:0,documentStatus:"Complete"});assert.ok(issues.some(x=>x.type==="Balance integrity"));});
test("passes a clean canonical record",()=>{const issues=validateLoan({id:"LN-1",borrowerId:"BR-1",loanType:"Personal",originationDate:"2025-01-01",maturityDate:"2028-01-01",originalPrincipal:100,currentBalance:80,interestRate:8,termMonths:36,borrowerState:"CA",paymentStatus:"Current",daysPastDue:0,documentStatus:"Complete"});assert.equal(issues.length,0);});
