import type { CSSProperties } from "react";
import type { ParsedFrontmatter } from "../../lib/frontmatter";
import { tagHue } from "../../lib/tagColor";
import { CalendarIcon } from "../icons/CalendarIcon";
import { UserIcon } from "../icons/UserIcon";

interface FrontmatterBlockProps {
  data: ParsedFrontmatter;
}

export function FrontmatterBlock({ data }: FrontmatterBlockProps) {
  const hasTags = Boolean(data.tags && data.tags.length > 0);

  return (
    <table className="frontmatter-table">
      <tbody>
        {data.title && (
          <tr>
            <th scope="row">Title</th>
            <td className="frontmatter-value-title">{data.title}</td>
          </tr>
        )}
        {data.author && (
          <tr>
            <th scope="row">Author</th>
            <td>
              <UserIcon className="frontmatter-cell-icon" />
              {data.author}
            </td>
          </tr>
        )}
        {data.date && (
          <tr>
            <th scope="row">Date</th>
            <td>
              <CalendarIcon className="frontmatter-cell-icon" />
              <time>{data.date}</time>
            </td>
          </tr>
        )}
        {hasTags && (
          <tr>
            <th scope="row">Tags</th>
            <td>
              <ul className="frontmatter-tags">
                {data.tags?.map((tag) => (
                  <li
                    key={tag}
                    className="frontmatter-tag"
                    style={{ "--tag-h": tagHue(tag) } as CSSProperties}
                  >
                    <span className="frontmatter-tag-hash" aria-hidden="true">
                      #
                    </span>
                    {tag}
                  </li>
                ))}
              </ul>
            </td>
          </tr>
        )}
        {data.extra.map(([key, value]) => (
          <tr key={key}>
            <th scope="row">{key}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
