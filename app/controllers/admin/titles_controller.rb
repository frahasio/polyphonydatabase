module Admin
  class TitlesController < AdminControllerBase
    def index
      respond_to do |format|
        format.html {
          @titles = Title
            .includes(:functions)
            .select("titles.*, count(inclusions.id) as inclusions_count")
              .left_outer_joins(compositions: :inclusions)
              .group("titles.id")
            .order(:text)
            .page(params[:page])
            .per(50)

          @functions = Function.order(:name)
        }

        format.json {
          titles = Title.search(params[:q]).order(:text)
          titles = titles.where(language: params[:language]) if params[:language].present?

          render json: {
            results: titles.select(:id, :text).map {|t| { id: t.id, text: t.text } },
            pagination: {
              more: false,
            }
          }
        }
      end
    end

    def create
      unless (title = Title.new(title_params)).save
        flash[:error] = title.errors.full_messages.to_sentence
      end

      redirect_to params[:return_to].presence || admin_titles_path(page: params[:page])
    end

    def update_all
      titles_to_update.each do |id, update_params|
        update_title(id, update_params)
      end

      redirect_to admin_titles_path(page: params[:page])
    end

    private

    def title_params
      params.require(:title).permit(
        :text,
        :language,
      )
    end

    def update_title(id, update_params)
      title = Title.find_by(id: id)
      return unless title

      update_params = update_params.permit(
        :text,
        :language,
        function_ids: [],
      )

      title.assign_attributes(update_params)

      other_functions = []
      other_compositions = []
      if title.text_changed? && (other_title = Title.find_by(text: title.text))
        other_id = other_title.id.to_s

        if (other_update_params = titles_to_update[other_id])
          update_title(other_id, other_update_params)
        end

        other_functions = other_title.functions.to_a
        other_compositions = other_title.compositions.to_a
        other_title.destroy!
      end

      unless title.save
        errors = title.errors.full_messages
        flash[:error] ||= ""
        flash[:error] += "#{errors.to_sentence}\n"
      end

      title.update(functions: title.functions + other_functions)
      other_compositions.each {|c| c.update(title_id: title.id) }
    end

    def titles_to_update
      params.require(:titles)
    end
  end
end
