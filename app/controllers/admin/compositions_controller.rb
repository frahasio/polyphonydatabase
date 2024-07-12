class Admin::CompositionsController < Admin::AdminControllerBase
  def index
    respond_to do |format|
      format.html {
        @title = Title.find_by(id: params[:title_id])
        @compositions = (@title.present? ? @title.compositions : Composition.none)
      }

      format.json {
        compositions = if params[:q].present?
          Composition
            .where(title_id: Title.search(params[:q]))
            .left_outer_joins(:title, :composers, :composition_type)
            .order("titles.text, composers.name, composition_types.name")
        else
          Composition.none
        end

        render json: {
          results: compositions.map { |c| { id: c.id, text: c.text } },
          pagination: {
            more: false,
          }
        }
      }
    end
  end

  def show
    @composition = Composition.find(params[:id])
  end

  def new
    @composition = Composition.new
  end

  def create
    return_to = params[:return_to]

    unless (composition = Composition.new(composition_params)).save
      flash[:error] = composition.errors.full_messages.to_sentence
      return_to.gsub!("false", "true")
    end

    redirect_to return_to || admin_compositions_path(title_id: composition.title_id)
  end

  # JSON API for the source catalogue form to find or create a compositions.
  # Takes all the unique parameters of a composition and returns an ID.
  def find_or_create
    title_id = if composition_params[:title_id] =~ /\A\d+\z/
      composition_params[:title_id].to_i
    elsif composition_params[:title_text].present?
      Title.find_or_create_by!(text: composition_params[:title_text]).id
    end

    composer_ids = Array(composition_params[:composer_ids]).map do |composer_id|
      next if composer_id.blank?

      if composer_id =~ /\A\d+\z/
        composer_id.to_i
      else
        Composer.find_or_create_by!(name: composer_id).id if composer_id.present?
      end
    end.compact.sort

    other_params = composition_params
      .except(:title_id, :title_text, :title_language, :composer_ids, :inclusion_id)
      .transform_values(&:presence)

    if all_blank?(title_id, composer_ids, other_params)
      render json: { id: nil }
    else
      composition = if composer_ids == [Composer::ANON_ID] && (inclusion_id = composition_params[:inclusion_id]).present?
        Composition
          .where(id: Inclusion.find(inclusion_id).composition_id)
          .find_by(title_id:, composer_id_list: composer_ids, **other_params)
      else
        Composition.find_by(title_id:, composer_id_list: composer_ids, **other_params)
      end

      composition ||= Composition.create!(title_id:, composer_ids:, **other_params)

      render json: { id: composition.id, titleidcheck: title_id }
    end
  end
# 113122
  def edit
    @composition = Composition.find(params[:id])
  end

  def update
    composition = Composition.find(params[:id])

    composition.assign_attributes(composition_params)

    if composition.save
      redirect_to admin_compositions_path(title_id: composition.title_id)
    else
      render :edit
    end
  end

  def confirm_delete
    @composition = Composition.find(params[:id])
  end

  def destroy
    composition = Composition.find(params[:id])
    composition.destroy!

    redirect_to admin_compositions_path(title_id: composition.title_id)
  end

  private

  def composition_params
    params.require(:composition).permit(
      :composition_type_id,
      :even_odd,
      :inclusion_id,
      :number_of_voices,
      :title_id,
      :title_language,
      :title_text,
      :tone,
      composer_ids: [],
    )
  end

  def all_blank?(title_id, composer_ids, other_params)
    title_id.blank? && composer_ids.blank? && other_params.values.all?(&:blank?)
  end
end
