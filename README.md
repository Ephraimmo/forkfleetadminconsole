# ForkFleet Admin & Operations Console

A complete, enterprise-grade Operations and Restaurant Management Portal for the **ForkFleet** food ordering and delivery ecosystem (integrated with the Customer App and Driver App).

---

## ⚡ Quick Start (Run Locally)

```bash
# 1. Install dependencies
npm install

# 2. Run unit tests
npm test

# 3. Start development server
npm run dev

# 4. Build for production
npm run build
```

---

## 🚀 Key Modules & Capabilities

- **Driver Fleet Management (`/drivers`)**:
  - Live real-time driver list subscribed to Firebase Realtime Database (`/drivers`).
  - Driver onboarding & approval machine: `pending` → `offline`/`approved`, `rejected`, `suspended`, `reactivated`.
  - Restaurant & branch assignment: Assign approved drivers to specific restaurant branches or all branches (expands to concrete tuples in `/driverAssignments`).
  - Strict eligibility filtering (only approved, active drivers assigned to the exact restaurant + branch receive orders).
- **Operations & Order Dispatch (`/dispatch`, `/orders`, `/kitchen`)**:
  - Dispatch board with delivery lanes (`ready` → `assigned` → `picked_up` → `on_the_way` → `delivered`) and counter pickup workflow.
  - Live Kitchen preparation queue and status tracking.
  - Live Delivery GPS and Fleet Map (`/live-map`).
- **Catalogue & Restaurant Management (`/restaurants`, `/menus`, `/inventory`)**:
  - Multi-branch restaurant management, business hours, and operational radius.
  - Real-time menu builder with categories, variants, add-ons, pricing, and rewards points.
  - Stock levels, low stock alerts, and purchase orders.
- **Commerce & Financials (`/customers`, `/payments`, `/promotions`, `/reports`)**:
  - Customer profiles, loyalty tiers, wallet balances, and spending analytics.
  - Payment gateway management, driver/restaurant payouts, and settlement reporting.
  - Promotions engine: Combo deals (e.g. 3-for-2 multi-buy), promo codes, and points rewards.
  - PDF/Excel exportable sales, tax, and inventory reports.
- **Platform Governance (`/access`, `/notifications`, `/support`, `/audit-logs`, `/settings`)**:
  - Role-Based Access Control (RBAC) with fine-grained permissions.
  - System-wide notifications and broadcasts.
  - Real-time customer/driver support tickets synced to Firebase.
  - Full audit logging on every administrative mutation.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Radix UI, TanStack Router & Start, Lucide Icons, Recharts.
- **Backend & Database**: Firebase Realtime Database (`e-comm-bd997`) + Supabase PostgreSQL.
- **Testing**: Vitest for driver assignment algorithms and dispatch rules.

---

Project Overview

Build a world-class, enterprise-grade Food Ordering & Delivery Management System similar to Uber Eats, DoorDash, Bolt Food, Mr D Food, Glovo, Deliveroo, Swiggy, and Zomato.

This project must build ONLY the Management Portal (Admin + Restaurant Management + Operations Portal).

Do NOT build the Customer Mobile App or the Driver Mobile App yet.

However, the entire backend, APIs, database, business logic, security, architecture, and workflows must already support those future applications.

The project must be scalable enough to support:

Millions of users

Thousands of restaurants

Thousands of drivers

Millions of daily orders

Use enterprise software engineering principles.

Never generate placeholder implementations.

Implement every feature completely.

Architecture

Design this as a Microservice Architecture.

Include:

API Gateway

Authentication Service

Restaurant Service

Menu Service

Order Service

Customer Service

Driver Service

Dispatch Service

Payment Service

Notification Service

Reporting Service

Promotion Service

Inventory Service

Audit Service

Support Service

Settings Service

Future-ready for:

Mobile Apps

Multiple countries

Multiple currencies

Multiple languages

Technology Stack

Frontend

React

TypeScript

Tailwind CSS

Responsive Design

Mobile First

Dark Mode

Light Mode

Backend

Node.js

Express

TypeScript

Database

PostgreSQL

Caching

Redis

Realtime

WebSockets

Socket.IO

Authentication

JWT

Refresh Tokens

Role Based Authentication

Storage

Cloudinary or S3

Maps

Google Maps API

Push Notifications

Firebase Cloud Messaging

Payments

Design abstraction layer supporting:

Stripe

PayFast

Yoco

Ozow

Peach Payments

Software Engineering Requirements

Use:

Clean Architecture

SOLID Principles

Repository Pattern

Service Layer

DTO Pattern

Validation

Exception Handling

Logging

Audit Trail

Unit Testing

Integration Testing

Every module must be production-ready.

Functional Requirements

Implement complete business logic.

Authentication

Login

Logout

Refresh Token

Forgot Password

Reset Password

Email Verification

Two-Factor Authentication (Optional)

Session Management

User Roles

Implement Role-Based Access Control.

Roles include:

Super Admin

Platform Administrator

Restaurant Owner

Restaurant Manager

Kitchen Manager

Kitchen Staff

Cashier

Dispatcher

Finance Manager

Customer Support

Marketing Manager

Inventory Manager

Branch Manager

Operations Manager

Auditor

Each role must have configurable permissions.

Dashboard

Build an enterprise dashboard showing:

Today's Orders

Completed Orders

Cancelled Orders

Pending Orders

Preparing Orders

Ready for Pickup

Out for Delivery

Delivered Orders

Total Revenue

Daily Revenue

Weekly Revenue

Monthly Revenue

Top Restaurants

Top Selling Meals

Best Customers

Driver Performance

Restaurant Performance

Sales Charts

Order Trends

Heat Maps

Live Orders

Live Driver Locations

Recent Activities

Notifications

Quick Actions

Restaurant Management

Restaurant Registration

Restaurant Approval

Restaurant Suspension

Restaurant Activation

Restaurant Categories

Business Hours

Branches

Operating Zones

Delivery Radius

Commission Settings

Restaurant Documents

Restaurant Verification

Restaurant Ratings

Restaurant Reviews

Restaurant Performance

Restaurant Wallet

Restaurant Settlements

Menu Management

Food Categories

Subcategories

Products

Meals

Combos

Variants

Add-ons

Extras

Pricing

Discount Pricing

Availability

Preparation Time

Images

Nutritional Information

Ingredients

Allergens

Out of Stock

Popular Items

Featured Items

Search

Filtering

Sorting

Inventory Management

Ingredients

Suppliers

Purchase Orders

Stock Levels

Stock Adjustments

Low Stock Alerts

Waste Tracking

Recipe Costing

Inventory Reports

Barcode Support

Expiry Dates

Batch Numbers

Order Management

Create Orders

Receive Orders

Accept Orders

Reject Orders

Auto Assignment

Manual Assignment

Kitchen Queue

Cooking Queue

Ready Queue

Dispatch Queue

Delivery Queue

Completed Orders

Cancelled Orders

Refunds

Order Notes

Special Instructions

Scheduled Orders

Order History

Order Tracking

Order Timeline

Invoices

Receipts

Order Status Flow

Pending

Accepted

Preparing

Ready

Assigned

Picked Up

On The Way

Delivered

Cancelled

Refunded

Every status change must be timestamped and stored in audit logs.

Customer Management

Customer Profiles

Addresses

Saved Locations

Order History

Spending

Loyalty Points

Coupons

Wallet

Support Tickets

Reviews

Ratings

Blocked Customers

Customer Analytics

Driver Management

Although the Driver App is not built yet, implement full backend management.

Driver Registration

Verification

Vehicle Information

License Upload

Availability

Online Status

Working Hours

Performance

Ratings

Documents

Current Orders

Past Orders

Live GPS

Driver Wallet

Driver Earnings

Driver Settlements

Driver Suspension

Dispatch System

Automatic Driver Assignment

Manual Assignment

Nearest Driver Search

GPS Radius Search

Geolocation

ETA Calculation

Distance Matrix

Route Optimization

Driver Availability

Delivery Zones

Load Balancing

Payment Management

Payment Gateway Integration Layer

Cash

Card

Wallet

Online Payments

Refunds

Partial Refunds

Settlement Reports

Commission Reports

Restaurant Payouts

Driver Payouts

Tax Reports

Invoices

Promotions

Coupons

Promo Codes

Campaigns

Restaurant Discounts

Category Discounts

Flash Sales

Referral Program

Loyalty Program

Reward Points

Birthday Rewards

Reports

Sales Reports

Revenue Reports

Tax Reports

Inventory Reports

Customer Reports

Restaurant Reports

Driver Reports

Finance Reports

Marketing Reports

Order Reports

Download PDF

Download Excel

Custom Date Filters

Notifications

Email

SMS

Push Notifications

In-App Notifications

System Alerts

Order Updates

Restaurant Updates

Driver Updates

Admin Alerts

Broadcast Notifications

Notification History

Customer Support

Support Tickets

Live Chat

Complaint Management

Refund Requests

Issue Escalation

Knowledge Base

Frequently Asked Questions

Internal Notes

Ticket Assignments

Settings

Platform Settings

Delivery Charges

Commission

Taxes

Currencies

Countries

Languages

Business Hours

Notification Settings

Security Policies

API Keys

Payment Settings

System Configuration

Feature Flags

Audit Logs

Every action must be logged.

Store:

User

Timestamp

IP Address

Action

Before Value

After Value

Affected Record

Search

Global Search

Restaurant Search

Customer Search

Order Search

Driver Search

Invoice Search

Menu Search

Advanced Filters

Realtime Features

Live Orders

Live Dashboard

Live Notifications

Live Kitchen Queue

Live Dispatch Queue

Live Driver Tracking

Live Order Tracking

Live Analytics

Non-Functional Requirements

Highly Available

Highly Scalable

Secure

Fault Tolerant

Fast

Responsive

Cloud Ready

Horizontally Scalable

Container Ready

Microservice Ready

API First

Event Driven

Reliable

Maintainable

CAP Theorem Considerations

Prioritize:

High Availability

for:

Restaurant Search

Browsing

Menus

Discovery

Prioritize:

Strong Consistency

for:

Orders

Payments

Refunds

Wallet Balances

Financial Transactions

Core Database Entities

Users

Roles

Permissions

Restaurants

Branches

Categories

Menus

Products

Variants

AddOns

Ingredients

Inventory

Orders

OrderItems

Payments

Transactions

Customers

Drivers

Vehicles

Dispatches

Notifications

Coupons

Promotions

Reviews

Ratings

SupportTickets

AuditLogs

Settings

Wallets

Invoices

Settlements

Reports

Every table must include:

UUID Primary Key

Created Date

Updated Date

Created By

Updated By

Active Flag

Soft Delete Flag

API Design

Design a complete REST API.

Use:

/api/v1/

Include:

Authentication APIs

Restaurant APIs

Menu APIs

Inventory APIs

Order APIs

Driver APIs

Dispatch APIs

Customer APIs

Reports APIs

Settings APIs

Notification APIs

Support APIs

Promotion APIs

Payment APIs

Analytics APIs

Each endpoint must include:

Authentication

Authorization

Validation

Pagination

Sorting

Filtering

Searching

Error Responses

Success Responses

HTTP Status Codes

Security

JWT Authentication

Refresh Tokens

Password Encryption

Role-Based Access

Permission-Based Access

Rate Limiting

CORS

Helmet

Input Validation

SQL Injection Protection

XSS Protection

CSRF Protection

Secure Headers

Audit Logging

UI Requirements

Professional

Modern

Minimal

Fast

Enterprise Dashboard

Responsive

Dark Mode

Light Mode

Sidebar Navigation

Breadcrumbs

Data Tables

Charts

Cards

Modals

Forms

Drawers

Notifications

Pagination

Global Search

Quick Actions

Loading Skeletons

Error States

Empty States

Accessibility (WCAG)

AI Development Instructions

Build the project module by module in this order:

Authentication

Roles & Permissions

Dashboard

Restaurant Management

Menu Management

Inventory

Orders

Customers

Drivers

Dispatch

Payments

Promotions

Reports

Notifications

Customer Support

Settings

Audit Logs

Analytics

API Documentation

Testing

Performance Optimization

Deployment

Do not skip modules.

Generate complete production-ready code.

Avoid mock implementations unless explicitly requested.

Maintain a consistent architecture and coding standards throughout the project.

Ensure every screen, API, database entity, workflow, and business rule is fully connected and functional.

This management portal will serve as the central operational system for the future Customer App and Driver App, so every backend capability required by those applications must already exist, even if their user interfaces are developed later.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d9a96291-ceca-458f-bb6c-bbf838a59066).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Documentation

- [`docs/CUSTOMER_APP_PROMOTIONS_INTEGRATION.md`](docs/CUSTOMER_APP_PROMOTIONS_INTEGRATION.md) — **handoff spec for the customer app**: every Firebase path, data contract, and the exact checkout algorithms (coupons, combo deals incl. 3-for-2 multi-buy, and the per-restaurant Points & Rewards programme). Give this to the customer-app developer or AI agent.
