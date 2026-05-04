import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface User {
  id: number;
  name: string;
  apiKeys: string[];
  isAdmin: boolean;
}

export interface CreateUserInput {
  name: string;
  password: string;
  apiKeys?: string[];
  isAdmin?: boolean;
}

const STORAGE_KEY = 'uix:auth:user';
const API_BASE = '/api';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly _user = signal<User | null>(this.loadFromStorage());

  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly isAdmin = computed(() => this._user()?.isAdmin === true);

  async login(name: string, password: string): Promise<User> {
    const user = await firstValueFrom(
      this.http.post<User>(`${API_BASE}/login`, { name, password })
    );
    this.setUser(user);
    return user;
  }

  logout(): void {
    this._user.set(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  listUsers(): Promise<User[]> {
    return firstValueFrom(this.http.get<User[]>(`${API_BASE}/users`));
  }

  createUser(input: CreateUserInput): Promise<User> {
    return firstValueFrom(this.http.post<User>(`${API_BASE}/users`, input));
  }

  deleteUser(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${API_BASE}/users/${id}`));
  }

  private setUser(user: User): void {
    this._user.set(user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  }

  private loadFromStorage(): User | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  }
}
